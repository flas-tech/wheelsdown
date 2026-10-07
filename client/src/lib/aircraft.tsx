// Plan-view (top-down, nose up) aircraft silhouettes, drawn from simple symmetric geometry so they read at 20px.
import { AIRCRAFT, MAX_AIRCRAFT, aircraftById, aircraftList, type AircraftId } from "@shared/aircraft";
import { cn } from "@/lib/utils";

type Pt = [number, number];
type Spec = {
  fus: { y0: number; y1: number; w: number; nose?: number; tail?: number };
  wing: Pt[]; // right half, from root leading edge outward then back to root trailing edge
  stab: Pt[];
  pods?: { x: number; y0: number; y1: number; w: number }[]; // right side only, mirrored
  props?: { x: number; y: number; span: number }[]; // x = 32 means nose prop
};
const C = 32;
const mirror = (half: Pt[]) => [...half, ...[...half].reverse().map(([x, y]) => [2 * C - x, y] as Pt)];
const poly = (pts: Pt[]) => "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + "Z";
function fuselage({ y0, y1, w, nose = w * 0.9, tail = 14 }: Spec["fus"]) {
  const h = w / 2;
  return `M${C - h} ${y0 + nose}C${C - h} ${y0 + nose * 0.35} ${C - h * 0.45} ${y0} ${C} ${y0}C${C + h * 0.45} ${y0} ${C + h} ${y0 + nose * 0.35} ${C + h} ${y0 + nose}`
    + `L${C + h} ${y1 - tail}L${C + 1} ${y1}L${C - 1} ${y1}L${C - h} ${y1 - tail}Z`;
}
const pod = (x: number, y0: number, y1: number, w: number) => {
  const r = w / 2;
  return `M${x - r} ${y0 + r}A${r} ${r} 0 0 1 ${x + r} ${y0 + r}L${x + r} ${y1 - 1}L${x - r} ${y1 - 1}Z`;
};

type HeliId = Extract<AircraftId, `heli_${string}`>;
type FixedId = Exclude<AircraftId, HeliId>;
const SPECS: Record<FixedId, Spec> = {
  sep: { // high straight wing, nose prop
    fus: { y0: 9, y1: 57, w: 7, nose: 5, tail: 20 },
    wing: [[C, 21], [61, 21], [61, 28.5], [C, 28.5]],
    stab: [[C, 50], [44, 50.5], [44, 55.5], [C, 56]],
    props: [{ x: C, y: 7.5, span: 15 }],
  },
  mep: { // straight wing, two wing-mounted engines
    fus: { y0: 10, y1: 57, w: 7, nose: 7, tail: 18 },
    wing: [[C, 25], [61, 26.5], [61, 31.5], [C, 33]],
    stab: [[C, 50], [44, 50.5], [44, 55.5], [C, 56]],
    pods: [{ x: 45, y0: 18, y1: 36, w: 5.5 }],
    props: [{ x: 45, y: 16.5, span: 14 }],
  },
  setp: { // longer cabin, tapered wing, T-tail
    fus: { y0: 6, y1: 58, w: 8.5, nose: 7, tail: 17 },
    wing: [[C, 25], [61, 28.5], [61, 32.5], [C, 35]],
    stab: [[C, 51.5], [45, 53.5], [45, 57.5], [C, 58]],
    props: [{ x: C, y: 4.5, span: 17 }],
  },
  metp: { // tapered wing, long nacelles, T-tail
    fus: { y0: 7, y1: 58, w: 8.5, nose: 8, tail: 16 },
    wing: [[C, 25], [62, 28], [62, 32], [C, 35]],
    stab: [[C, 51], [46, 53], [46, 57.5], [C, 58]],
    pods: [{ x: 45.5, y0: 18, y1: 40, w: 6 }],
    props: [{ x: 45.5, y: 16.5, span: 15 }],
  },
  light_jet: { // mild sweep, aft-fuselage engines, T-tail
    fus: { y0: 7, y1: 57, w: 8.5, nose: 11, tail: 13 },
    wing: [[C, 26], [60, 33], [60, 36.5], [C, 38]],
    stab: [[C, 50.5], [44.5, 54.5], [44.5, 57.5], [C, 56.5]],
    pods: [{ x: 40.6, y0: 39, y1: 49, w: 5.5 }],
  },
  midsize_jet: { // more sweep, winglets suggested by a raked tip
    fus: { y0: 5, y1: 59, w: 9, nose: 12, tail: 13 },
    wing: [[C, 25], [58, 36], [61, 39], [58, 39.5], [C, 39]],
    stab: [[C, 52], [46, 56.5], [46, 59], [C, 58]],
    pods: [{ x: 41.2, y0: 40, y1: 51, w: 6 }],
  },
  large_jet: { // long cabin, strong sweep, big aft engines
    fus: { y0: 3, y1: 61, w: 9.5, nose: 13, tail: 13 },
    wing: [[C, 24], [59, 37.5], [62.5, 41], [59, 41.5], [C, 39]],
    stab: [[C, 53.5], [47, 58.5], [47, 61], [C, 60]],
    pods: [{ x: 41.8, y0: 41, y1: 53, w: 6.5 }],
  },
  airliner: { // swept wing, underwing engines, low tail
    fus: { y0: 2, y1: 62, w: 9, nose: 9, tail: 12 },
    wing: [[C, 23], [62, 38], [62, 41], [C, 37]],
    stab: [[C, 52], [47, 58], [47, 61], [C, 59]],
    pods: [{ x: 44, y0: 23, y1: 33, w: 6 }],
  },
  widebody: { // wide fuselage, big underwing engines
    fus: { y0: 2, y1: 62, w: 12, nose: 11, tail: 13 },
    wing: [[C, 22], [63, 38], [63, 41], [C, 37]],
    stab: [[C, 51.5], [49, 57.5], [49, 61], [C, 59.5]],
    pods: [{ x: 46, y0: 22, y1: 34, w: 8 }],
  },
};


// Helicopters, also plan view nose up: rotor blades over a teardrop cabin, tail boom with a side tail rotor.
// Size, blade count, skids versus sponsons and a horizontal stabilizer separate the classes.
type Heli = { cabin: [number, number]; hubY: number; blades: number; len: number; bw: number; boomEnd: number; gear: "skids" | "sponsons"; stab: boolean; twinRotor?: boolean };
const HELI: Record<HeliId, Heli> = {
  heli_sp: { cabin: [6.5, 9], hubY: 24, blades: 2, len: 28, bw: 2.8, boomEnd: 57, gear: "skids", stab: false },
  heli_st: { cabin: [7, 11], hubY: 25, blades: 3, len: 28, bw: 3, boomEnd: 59, gear: "skids", stab: true },
  heli_lt: { cabin: [7.5, 12], hubY: 25, blades: 4, len: 28.5, bw: 3, boomEnd: 60, gear: "skids", stab: true },
  heli_mt: { cabin: [8, 13.5], hubY: 26, blades: 5, len: 29.5, bw: 3.2, boomEnd: 61, gear: "sponsons", stab: true },
  heli_ht: { cabin: [9, 15], hubY: 27, blades: 5, len: 30.5, bw: 3.8, boomEnd: 62, gear: "sponsons", stab: true },
};
function HeliIcon({ id, className, title }: { id: HeliId; className?: string; title?: string }) {
  const h = HELI[id];
  const [rx, ry] = h.cabin;
  const cy = h.hubY + 2;
  const top = cy - ry;
  const cabin = `M${C} ${top}C${C + rx * 1.1} ${top} ${C + rx} ${cy + ry * 0.55} ${C + rx * 0.55} ${cy + ry}L${C - rx * 0.55} ${cy + ry}C${C - rx} ${cy + ry * 0.55} ${C - rx * 1.1} ${top} ${C} ${top}Z`;
  const boomTop = cy + ry - 1;
  const start = h.blades === 2 ? 90 : h.blades === 4 ? 45 : h.blades === 5 ? 36 : 60; // keep a blade off the tail boom
  return (
    <svg viewBox="0 0 64 64" className={cn("h-6 w-6", className)} role="img" aria-label={title || aircraftById(id)?.label}>
      {h.gear === "skids"
        ? [-1, 1].map((sd) => <rect key={sd} x={C + sd * (rx + 2.4) - 1.1} y={cy - ry * 0.55} width={2.2} height={ry * 1.3} rx={1.1} fill="currentColor" />)
        : [-1, 1].map((sd) => <rect key={sd} x={C + sd * (rx + 1.5) - 2.5} y={cy + ry * 0.1} width={5} height={ry * 0.6} rx={2} fill="currentColor" />)}
      <path d={`M${C - 2.4} ${boomTop}L${C + 2.4} ${boomTop}L${C + 1.4} ${h.boomEnd}L${C - 1.4} ${h.boomEnd}Z`} fill="currentColor" />
      {h.stab && <rect x={C - 6.5} y={h.boomEnd - 10} width={13} height={2.4} rx={1.2} fill="currentColor" />}
      <rect x={C + 1.8} y={h.boomEnd - 7} width={2.2} height={8.5} rx={1.1} fill="currentColor" />
      <path d={cabin} fill="currentColor" />
      <g>
        {Array.from({ length: h.blades }, (_, i) => (
          <rect key={i} x={C - h.bw / 2} y={h.hubY - h.len} width={h.bw} height={h.len} rx={h.bw / 2} fill="currentColor"
            transform={`rotate(${start + (360 / h.blades) * i} ${C} ${h.hubY})`} />
        ))}
      </g>
      <circle cx={C} cy={h.hubY} r={h.bw * 0.9} fill="currentColor" />
    </svg>
  );
}

export function AircraftIcon({ type, className, title }: { type: string | null | undefined; className?: string; title?: string }) {
  const id = (aircraftById(type)?.id || "sep") as AircraftId;
  if (id.startsWith("heli_")) return <HeliIcon id={id as HeliId} className={className} title={title} />;
  const s = SPECS[id as FixedId];
  const pods = (s.pods || []).flatMap((p) => [pod(p.x, p.y0, p.y1, p.w), pod(2 * C - p.x, p.y0, p.y1, p.w)]);
  const props = (s.props || []).flatMap((p) => (p.x === C ? [p] : [p, { ...p, x: 2 * C - p.x }]));
  return (
    <svg viewBox="0 0 64 64" className={cn("h-6 w-6", className)} role="img" aria-label={title || aircraftById(id)?.label}>
      <path d={poly(mirror(s.wing))} fill="currentColor" />
      <path d={poly(mirror(s.stab))} fill="currentColor" />
      {pods.map((d, i) => <path key={i} d={d} fill="currentColor" />)}
      <path d={fuselage(s.fus)} fill="currentColor" />
      {props.map((p, i) => <rect key={i} x={p.x - p.span / 2} y={p.y - 0.9} width={p.span} height={1.8} rx={0.9} fill="currentColor" opacity={0.85} />)}
    </svg>
  );
}

/** Round avatar showing the crew member's chosen aircraft (a neutral outline if none is set yet). */
export function CrewAvatar({ aircraft, className, dark }: { aircraft?: string | null; className?: string; dark?: boolean }) {
  const a = aircraftById(aircraft);
  return (
    <span className={cn("inline-grid h-9 w-9 shrink-0 place-items-center rounded-full", dark ? "bg-white/10 text-[#F5C518]" : "bg-primary/15 text-primary", !a && "opacity-60", className)}
      title={a ? `${a.label} · ${a.example}` : "No aircraft picked yet"} data-testid="avatar-aircraft">
      {a ? <AircraftIcon type={a.id} className="h-[70%] w-[70%]" /> : <AircraftIcon type="sep" className="h-[60%] w-[60%] opacity-40" title="No aircraft picked yet" />}
    </span>
  );
}

/** Multi-select grid for the profile form. The first aircraft picked is the avatar. */
export function AircraftPicker({ value, onChange }: { value: string; onChange: (list: string) => void }) {
  const picked = aircraftList(value).map((a) => a.id as string);
  const toggle = (id: string) => onChange((picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= MAX_AIRCRAFT ? picked : [...picked, id]).join(","));
  const avatar = (id: string) => onChange([id, ...picked.filter((x) => x !== id)].join(","));
  const group = (kind: "fixed" | "heli", label: string) => (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={label}>
        {AIRCRAFT.filter((a) => a.kind === kind).map((a) => {
          const on = picked.includes(a.id);
          const first = picked[0] === a.id;
          const full = !on && picked.length >= MAX_AIRCRAFT;
          return (
            <div key={a.id} className="relative">
              <button type="button" role="checkbox" aria-checked={on} disabled={full} onClick={() => toggle(a.id)} data-testid={`button-aircraft-${a.id}`}
                className={cn("flex h-full w-full flex-col items-center gap-1 rounded-xl border px-1.5 pt-5 pb-1.5 text-center hover-elevate disabled:opacity-40",
                  on ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground")}>
                <AircraftIcon type={a.id} className={cn("h-9 w-9", on ? "text-primary" : "")} />
                <span className="text-[11px] font-semibold leading-tight">{a.label}</span>
                <span className="text-[9.5px] leading-tight opacity-75">{a.example}</span>
              </button>
              {on && (first
                ? <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded bg-primary px-1 text-[9px] font-bold text-primary-foreground" data-testid={`badge-avatar-${a.id}`}>AVATAR</span>
                : <button type="button" onClick={() => avatar(a.id)} className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded border border-primary/50 bg-background px-1 text-[9px] font-semibold text-primary" data-testid={`button-avatar-${a.id}`}>Set avatar</button>)}
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="space-y-3" data-testid="picker-aircraft">
      <p className="text-[11px] text-muted-foreground">Pick everything you fly, up to {MAX_AIRCRAFT}. Tap "Set avatar" to choose which one shows next to your name. {picked.length > 0 && <span className="font-semibold text-foreground tabular">{picked.length}/{MAX_AIRCRAFT} picked</span>}</p>
      {group("fixed", "Airplanes")}
      {group("heli", "Helicopters")}
    </div>
  );
}
