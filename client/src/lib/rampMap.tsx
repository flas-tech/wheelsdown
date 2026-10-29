// World map of ramp check reports (lazy-loaded). Leaflet + OpenStreetMap tiles; visible attribution, no prefetching.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { RAMP_AGENCIES, type RampMapField } from "@shared/rampChecks";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const label = (id: string) => RAMP_AGENCIES.find((a) => a.id === id)?.label || "Other";
import { rampColor } from "./rampMapColor";
function when(t: number) {
  const h = (Date.now() - t) / 3600_000;
  if (h < 1) return "within the hour"; if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
}

export default function RampMap({ fields, focus, onPick, className }: { fields: RampMapField[]; focus?: string | null; onPick?: (icao: string) => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const marks = useRef(new Map<string, L.CircleMarker>());
  const pick = useRef(onPick); pick.current = onPick;

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: false, worldCopyJump: true, minZoom: 1 }).setView([25, -40], 2);
    L.control.zoom({ position: "topright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.attributionControl.setPrefix(false);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  const fitted = useRef("");
  useEffect(() => {
    const m = map.current, g = layer.current; if (!m || !g) return;
    g.clearLayers(); marks.current.clear();
    // quietest first so active fields draw on top
    const order = [...fields].sort((a, b) => Number(a.active) - Number(b.active) || Number(a.hot) - Number(b.hot) || a.last - b.last);
    for (const f of order) {
      const c = rampColor(f);
      const mk = L.circleMarker([f.lat, f.lon], { radius: Math.min(22, 7 + Math.sqrt(f.reports) * 3), color: "#fff", weight: 2, fillColor: c, fillOpacity: 0.85 });
      const ag = Object.entries(f.agencies).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(label(k))}: ${n}`).join("<br>");
      const place = [f.city, f.country].filter(Boolean).join(" · ");
      mk.bindPopup(`<div style="font:13px system-ui;min-width:170px"><div style="font:700 13px ui-monospace,Menlo,monospace">${esc(f.icao)}</div>`
        + (f.name ? `<div>${esc(f.name)}</div>` : "") + (place ? `<div style="color:#64748b">${esc(place)}</div>` : "")
        + `<div style="margin-top:6px;font-weight:600;color:${c}">${f.active ? "Active · " : f.hot ? "Hot spot · " : ""}${f.reports} report${f.reports === 1 ? "" : "s"}</div>`
        + `<div style="color:#64748b">Last ${esc(when(f.last))}</div><div style="margin-top:4px">${ag}</div></div>`);
      mk.on("click", () => pick.current?.(f.icao));
      mk.addTo(g); marks.current.set(f.icao, mk);
    }
    const key = fields.map((f) => f.icao).join(",");
    if (key !== fitted.current) {
      fitted.current = key;
      if (fields.length === 1) m.setView([fields[0].lat, fields[0].lon], 6);
      else if (fields.length) m.fitBounds(L.latLngBounds(fields.map((f) => [f.lat, f.lon] as [number, number])), { padding: [30, 30], maxZoom: 6 });
      else m.setView([25, -40], 2);
    }
  }, [fields]);

  useEffect(() => {
    const mk = focus ? marks.current.get(focus) : null; const m = map.current;
    if (mk && m) { m.setView(mk.getLatLng(), Math.max(m.getZoom(), 6)); mk.openPopup(); }
  }, [focus]);

  return <div ref={box} className={className} style={{ zIndex: 0 }} data-testid="map-ramp" />;
}
