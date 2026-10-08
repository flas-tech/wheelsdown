// Interactive map for Search (List | Map). Leaflet + OpenStreetMap tiles, loaded only when the map is opened.
// OSM tile policy: normal interactive viewing only, visible attribution, no prefetching or offline downloads.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { Expand, LocateFixed, Loader2, X } from "lucide-react";
import type { Category, SpotWithStats } from "@shared/schema";
import { getPosition } from "@/lib/geo";
import { cn } from "@/lib/utils";

export const MAP_COLORS: Record<Category, string> = { eat: "#E8A317", do: "#0E9F8E", stay: "#7C5CDB", fbo: "#475569" };
type Leg = { icao: string; lat: number; lon: number; name?: string };

// lucide icon shapes (Utensils, Compass, BedDouble, PlaneLanding) as plain SVG, so pins need no React renderer
const GLYPHS: Record<Category, string> = {
  eat: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  do: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
  stay: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
  fbo: '<path d="M2 22h20"/><path d="M3.77 10.77 2 9l2-4.5 1.1.55c.55.28.9.84.9 1.45s.35 1.17.9 1.45L8 8.5l3-6 1.05.53a2 2 0 0 1 1.09 1.52l.72 5.4a2 2 0 0 0 1.09 1.52l4.4 2.2c.42.22.78.55 1.01.96l.6 1.03c.49.88-.06 1.98-1.06 2.1l-1.18.15c-.47.06-.95-.02-1.37-.24L4.29 11.15a2 2 0 0 1-.52-.38Z"/>',
};
const glyph = (c: Category) => `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[c] || ""}</svg>`;

function spotIcon(s: SpotWithStats, selected: boolean) {
  const color = MAP_COLORS[s.category as Category] || "#475569";
  const avoid = (s as any).goArounds > 0 && (s as any).goArounds * 2 >= s.reviewCount; // most crews say go around
  const size = selected ? 40 : 30;
  return L.divIcon({
    className: "wd-pin",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:2.5px solid ${avoid ? "#F97316" : "#fff"};border-radius:999px 999px 999px 4px;transform:rotate(-45deg);display:grid;place-items:center;box-shadow:0 2px 6px rgba(11,18,34,.35)${selected ? ",0 0 0 4px rgba(249,184,6,.55)" : ""}"><div style="transform:rotate(45deg);display:grid;place-items:center">${glyph(s.category as Category)}</div></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size],
  });
}
const airportIcon = (icao: string) => L.divIcon({
  className: "wd-apt",
  html: `<div style="transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:4px;background:#0B1222;color:#F9B806;border:2px solid #F9B806;border-radius:8px;padding:2px 6px;font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">${icao}</div>`,
  iconSize: [0, 0],
});
const clusterIcon = (c: L.MarkerCluster) => {
  const n = c.getChildCount(); const size = n < 10 ? 34 : n < 50 ? 40 : 46;
  return L.divIcon({ className: "wd-cluster", iconSize: [size, size],
    html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:#F9B806;color:#0B1222;display:grid;place-items:center;font:700 13px system-ui;border:3px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(11,18,34,.35)">${n}</div>` });
};

export default function SpotsMap({ spots, legs, focusId, renderCard, className }: {
  spots: SpotWithStats[]; legs: Leg[]; focusId?: number | null;
  renderCard: (s: SpotWithStats) => React.ReactNode; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.MarkerClusterGroup | null>(null);
  const extras = useRef<L.LayerGroup | null>(null);
  const apts = useRef<L.LayerGroup | null>(null);
  const showAllApts = useRef(false);
  const me = useRef<L.CircleMarker | null>(null);
  const [selected, setSelected] = useState<number | null>(focusId ?? null);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState("");
  const pinned = useMemo(() => spots.filter((s) => s.lat != null && s.lng != null), [spots]);
  const sel = pinned.find((s) => s.id === selected) || null;

  // create once
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([33, -90], 4);
    L.control.zoom({ position: "topright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.attributionControl.setPrefix(false);
    layer.current = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon }).addTo(m);
    extras.current = L.layerGroup().addTo(m);
    apts.current = L.layerGroup();
    // airport labels: always on a route; when browsing everything, only once zoomed in (they crowd the overview)
    const syncApts = () => { const on = showAllApts.current || m.getZoom() >= 7; if (on && !m.hasLayer(apts.current!)) apts.current!.addTo(m); if (!on && m.hasLayer(apts.current!)) apts.current!.remove(); };
    m.on("zoomend", syncApts);
    (m as any)._wdSyncApts = syncApts;
    m.on("click", () => setSelected(null));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  // pins, airports and route line whenever the results change
  const fitted = useRef("");
  useEffect(() => {
    const m = map.current, g = layer.current, x = extras.current, ax = apts.current;
    if (!m || !g || !x || !ax) return;
    g.clearLayers(); x.clearLayers(); ax.clearLayers();
    showAllApts.current = legs.length > 0;
    for (const s of pinned) {
      const mk = L.marker([s.lat!, s.lng!], { icon: spotIcon(s, s.id === selected), title: s.name, keyboard: true, riseOnHover: true, zIndexOffset: s.id === selected ? 1000 : 0 });
      mk.on("click", (e) => { L.DomEvent.stopPropagation(e); setSelected(s.id); });
      g.addLayer(mk);
    }
    // airports: the route's legs, or every field that has picks
    const aptMap = new Map<string, Leg>();
    for (const l of legs) aptMap.set(l.icao, l);
    if (!legs.length) for (const s of spots) if (s.airport?.lat != null && s.airport?.lon != null) aptMap.set(s.icao, { icao: s.icao, lat: s.airport.lat, lon: s.airport.lon, name: s.airport.name });
    for (const a of Array.from(aptMap.values())) L.marker([a.lat, a.lon], { icon: airportIcon(a.icao), interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(ax);
    if (legs.length > 1) L.polyline(legs.map((l) => [l.lat, l.lon] as [number, number]), { color: "#0B1222", weight: 2, opacity: 0.55, dashArray: "6 8" }).addTo(x);
    // fit only when the set of results changes, not when a pin is selected
    const key = pinned.map((s) => s.id).join(",") + "|" + legs.map((l) => l.icao).join(",");
    if (key !== fitted.current) {
      fitted.current = key;
      const pts: [number, number][] = [...pinned.map((s) => [s.lat!, s.lng!] as [number, number]), ...Array.from(aptMap.values()).map((a) => [a.lat, a.lon] as [number, number])];
      const focus = focusId != null ? pinned.find((s) => s.id === focusId) : null;
      if (focus) m.setView([focus.lat!, focus.lng!], 15);
      else if (pts.length === 1) m.setView(pts[0], 13);
      else if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 14 });
    }
    (m as any)._wdSyncApts?.();
  }, [pinned, legs, spots, selected, focusId]);

  // keep the chosen pin visible above its card
  useEffect(() => {
    const m = map.current; if (!m || !sel) return;
    const pt = m.latLngToContainerPoint([sel.lat!, sel.lng!]); const h = m.getSize().y, w = m.getSize().x;
    const targetY = h * 0.3;
    if (pt.y > h * 0.45 || pt.y < 40 || pt.x < 30 || pt.x > w - 30) m.panBy([pt.x - w / 2, pt.y - targetY], { animate: true, duration: 0.35 });
  }, [selected]); // eslint-disable-line

  async function locate() {
    setLocating(true); setErr("");
    try {
      const p = await getPosition();
      const m = map.current!;
      me.current?.remove();
      me.current = L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#2563EB", fillOpacity: 1 }).addTo(m);
      m.setView([p.lat, p.lng], 13);
    } catch (e) { setErr(String((e as Error).message || e).replace(/^\d+: /, "")); }
    finally { setLocating(false); }
  }
  function fitAll() {
    const m = map.current; if (!m) return;
    const pts = pinned.map((s) => [s.lat!, s.lng!] as [number, number]).concat(legs.map((l) => [l.lat, l.lon] as [number, number]));
    if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 14 });
  }

  const btn = "grid h-10 w-10 place-items-center rounded-xl border border-border bg-card text-foreground shadow-md hover-elevate";
  return (
    <div className={cn("relative isolate overflow-hidden rounded-2xl border border-card-border bg-muted", className)} data-testid="map-search">
      <div ref={box} className="wd-map absolute inset-0" role="application" aria-label="Map of picks" />
      <div className="absolute left-3 top-3 z-[500] flex flex-col gap-2">
        <button type="button" onClick={locate} disabled={locating} className={btn} aria-label="Show my location" data-testid="button-map-locate">
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-primary" />}
        </button>
        <button type="button" onClick={fitAll} className={btn} aria-label="Show all picks" data-testid="button-map-fit"><Expand className="h-4 w-4" /></button>
      </div>
      {err && <p className="absolute left-16 right-16 top-3 z-[500] rounded-lg bg-card/95 px-3 py-2 text-xs shadow" role="status">{err}</p>}
      {sel && (
        <div className="absolute inset-x-2 bottom-6 z-[600] sm:inset-x-auto sm:left-3 sm:w-[380px]" data-testid="map-selected">
          <div className="relative">
            <div className="absolute -top-11 right-0 z-10">
              <button type="button" onClick={() => setSelected(null)} aria-label="Close" data-testid="button-map-close"
                className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-semibold shadow-lg hover-elevate"><X className="h-3.5 w-3.5" />Close</button>
            </div>
            <div className="max-h-[44vh] overflow-y-auto rounded-2xl shadow-2xl">{renderCard(sel)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
