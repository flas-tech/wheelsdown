// Static map renderer: OpenStreetMap raster tiles + numbered pins drawn on a canvas.
// One renderer for the on-screen map and the PDF, so what crews see is what gets exported.
// Tiles are fetched only for the area being viewed (no prefetching), per the OSM tile usage policy.

export type MapPin = { lat: number; lng: number; label: string; kind: "airport" | "eat" | "do" | "stay" | "fbo" };

const TILE = 256;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
export const PIN_COLORS: Record<MapPin["kind"], string> = {
  airport: "#0B1222", eat: "#E8A317", do: "#0E9F8E", stay: "#7C5CDB", fbo: "#475569",
};

const lon2x = (lng: number, z: number) => ((lng + 180) / 360) * Math.pow(2, z) * TILE;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z) * TILE;
};

const tileCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const n = Math.pow(2, z);
  const xx = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${xx}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // keeps the canvas exportable for the PDF
      img.referrerPolicy = "strict-origin-when-cross-origin";
      img.onload = () => resolve(img);
      img.onerror = () => { tileCache.delete(key); resolve(null); };
      img.src = TILE_URL(z, xx, y);
    }));
  }
  return tileCache.get(key)!;
}

/** Pick the highest zoom where every pin fits inside the padded frame. */
function fitZoom(pins: MapPin[], w: number, h: number, pad: number) {
  if (pins.length <= 1) return 14;
  for (let z = 16; z >= 2; z--) {
    const xs = pins.map((p) => lon2x(p.lng, z)), ys = pins.map((p) => lat2y(p.lat, z));
    if (Math.max(...xs) - Math.min(...xs) <= w - pad * 2 && Math.max(...ys) - Math.min(...ys) <= h - pad * 2) return z;
  }
  return 2;
}

/**
 * Draw the map into a canvas at `scale` device pixels per CSS pixel.
 * Returns true when every tile loaded (false = some tiles missing, map still usable).
 */
export async function drawStaticMap(canvas: HTMLCanvasElement, pins: MapPin[], w: number, h: number, opts: { scale?: number; route?: boolean } = {}) {
  const scale = opts.scale ?? Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = "#E8ECEF";
  ctx.fillRect(0, 0, w, h);
  if (!pins.length) return true;

  const pad = 34;
  const z = fitZoom(pins, w, h, pad);
  const xs = pins.map((p) => lon2x(p.lng, z)), ys = pins.map((p) => lat2y(p.lat, z));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const left = cx - w / 2, top = cy - h / 2;

  // tiles
  const tx0 = Math.floor(left / TILE), ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + w) / TILE), ty1 = Math.floor((top + h) / TILE);
  const jobs: Promise<boolean>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    jobs.push(loadTile(z, tx, ty).then((img) => {
      if (img) ctx.drawImage(img, tx * TILE - left, ty * TILE - top, TILE, TILE);
      return !!img;
    }));
  }
  const loaded = await Promise.all(jobs);

  // soften tiles so pins read clearly
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, w, h);

  const pts = pins.map((p) => ({ ...p, x: lon2x(p.lng, z) - left, y: lat2y(p.lat, z) - top }));

  // route line between airports (overview map)
  if (opts.route) {
    const aps = pts.filter((p) => p.kind === "airport");
    if (aps.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#0B1222"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); aps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.restore();
    }
  }

  // airport labels first, numbered picks on top so on-field spots stay visible
  const order = [...pts].sort((a, b) => (a.kind === "airport" ? 0 : 1) - (b.kind === "airport" ? 0 : 1));
  // airport labels never cover each other: nudge a colliding tag to the nearest free spot and draw a leader to the field
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const seenAp = new Set<string>();
  type P = (typeof pts)[number];
  const tags: { p: P; cx: number; cy: number; tw: number; th: number }[] = [];
  const picks: P[] = [];
  const hits = (b: { x: number; y: number; w: number; h: number }) => placed.some((o) => b.x < o.x + o.w + 3 && b.x + b.w + 3 > o.x && b.y < o.y + o.h + 3 && b.y + b.h + 3 > o.y);
  for (const p of order) {
    if (p.kind === "airport") {
      if (seenAp.has(p.label)) continue; // a return leg to the same field gets one tag
      seenAp.add(p.label);
      ctx.font = "700 11px ui-monospace, Menlo, monospace";
      const tw = ctx.measureText(p.label).width + 12, th = 22;
      const tries: [number, number][] = [[0, 0]];
      for (const d of [1, 2, 3]) tries.push([0, -26 * d], [0, 26 * d], [(tw + 6) * d, 0], [-(tw + 6) * d, 0], [(tw / 2 + 8) * d, -26 * d], [-(tw / 2 + 8) * d, 26 * d]);
      let cx = p.x, cy = p.y;
      for (const [dx, dy] of tries) {
        const bx = { x: p.x + dx - tw / 2, y: p.y + dy - th / 2, w: tw, h: th };
        if (bx.x < 2 || bx.y < 2 || bx.x + bx.w > w - 2 || bx.y + bx.h > h - 18) continue;
        if (!hits(bx)) { cx = p.x + dx; cy = p.y + dy; break; }
      }
      placed.push({ x: cx - tw / 2, y: cy - th / 2, w: tw, h: th });
      tags.push({ p, cx, cy, tw, th });
    } else picks.push(p);
  }
  // leaders under every tag, then tags, then numbered picks on top
  for (const t of tags) if (t.cx !== t.p.x || t.cy !== t.p.y) {
    ctx.save(); ctx.strokeStyle = "#0B1222"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(t.p.x, t.p.y); ctx.lineTo(t.cx, t.cy); ctx.stroke();
    ctx.beginPath(); ctx.arc(t.p.x, t.p.y, 4, 0, Math.PI * 2); ctx.fillStyle = "#0B1222"; ctx.fill();
    ctx.restore();
  }
  for (const { p, cx, cy, tw, th } of tags) {
    {
      ctx.font = "700 11px ui-monospace, Menlo, monospace";
      roundRect(ctx, cx - tw / 2, cy - th / 2, tw, th, 5);
      ctx.fillStyle = "#F5C518"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#0B1222"; ctx.stroke();
      ctx.fillStyle = "#0B1222"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.label, cx, cy + 0.5);
    }
  }
  for (const p of picks) {
    {
      const r = 11;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = PIN_COLORS[p.kind]; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = "#FFFFFF"; ctx.stroke();
      ctx.fillStyle = "#FFFFFF"; ctx.font = "700 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.label, p.x, p.y + 0.5);
    }
  }

  // attribution (required by the OSM licence)
  const att = "© OpenStreetMap contributors";
  ctx.font = "10px system-ui, -apple-system, sans-serif";
  const aw = ctx.measureText(att).width + 8;
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(w - aw, h - 15, aw, 15);
  ctx.fillStyle = "#334155"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText(att, w - 4, h - 7.5);
  return loaded.every(Boolean);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Render off-screen and return a PNG data URL (for the PDF). Null if the canvas can't be exported. */
export async function staticMapDataUrl(pins: MapPin[], w: number, h: number, opts: { route?: boolean } = {}) {
  const c = document.createElement("canvas");
  await drawStaticMap(c, pins, w, h, { scale: 2, route: opts.route });
  try { return c.toDataURL("image/jpeg", 0.88); } catch { return null; }
}
