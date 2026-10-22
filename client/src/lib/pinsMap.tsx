// Interactive (pan / pinch-zoom) version of the trip sheet maps, four-tab preview only. Same numbered pins and colors as
// the static canvas map (lib/staticMap.ts), which the PDF still uses. Leaflet + OpenStreetMap, loaded only when shown.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PIN_COLORS, type MapPin } from "@/lib/staticMap";

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function pinIcon(p: MapPin) {
  if (p.kind === "airport") {
    return L.divIcon({
      className: "wd-apt",
      html: `<div style="transform:translate(-50%,-50%);display:inline-flex;background:#0B1222;color:#F9B806;border:2px solid #F9B806;border-radius:8px;padding:2px 6px;font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">${esc(p.label)}</div>`,
      iconSize: [0, 0],
    });
  }
  const color = p.dot || PIN_COLORS[p.kind] || "#475569";
  const s = 26;
  const style = p.ai
    ? `background:#fff;color:${color};border:2.5px dashed ${color}`
    : `background:${color};color:#fff;border:2.5px solid #fff`;
  return L.divIcon({
    className: "wd-pin",
    html: `<div style="width:${s}px;height:${s}px;${style};border-radius:999px;display:grid;place-items:center;font:700 12px/1 system-ui;box-shadow:0 2px 6px rgba(11,18,34,.35)">${esc(p.label)}</div>`,
    iconSize: [s, s], iconAnchor: [s / 2, s / 2],
  });
}

export default function PinsMap({ pins, height, route, testId }: { pins: MapPin[]; height: number; route?: boolean; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!box.current || map.current) return;
    // one finger pans, two fingers pinch-zoom; the scroll wheel doesn't hijack page scrolling on a computer
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, worldCopyJump: true }).setView([33, -90], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    m.attributionControl.setPrefix(false);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  const sig = JSON.stringify(pins) + (route ? "r" : "");
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    // airports underneath, picks on top (in their number order)
    for (const p of pins) L.marker([p.lat, p.lng], { icon: pinIcon(p), interactive: false, keyboard: false, zIndexOffset: p.kind === "airport" ? -500 : 0 }).addTo(g);
    if (route && pins.length > 1) L.polyline(pins.map((p) => [p.lat, p.lng] as [number, number]), { color: "#0B1222", weight: 2, opacity: 0.55, dashArray: "6 8" }).addTo(g);
    const pts = pins.map((p) => [p.lat, p.lng] as [number, number]);
    if (pts.length === 1) m.setView(pts[0], 13);
    else if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 15 });
  }, [sig]); // eslint-disable-line

  return <div ref={box} className="wd-pins-map isolate w-full overflow-hidden rounded-xl border border-border bg-muted" style={{ height, zIndex: 0 }} data-testid={testId} role="region" aria-label="Map of briefing locations. Drag to move, pinch or use + and − to zoom." />;
}
