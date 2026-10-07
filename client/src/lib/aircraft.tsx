// Plan-view (top-down, nose up) aircraft silhouettes, drawn from simple symmetric geometry so they read at 20px.
import { AIRCRAFT, aircraftById, type AircraftId } from "@shared/aircraft";
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

const SPECS: Record<AircraftId, Spec> = {
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

export function AircraftIcon({ type, className, title }: { type: string | null | undefined; className?: string; title?: string }) {
  const id = (aircraftById(type)?.id || "sep") as AircraftId;
  const s = SPECS[id];
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

/** Pick-one grid for the profile form. */
export function AircraftPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Profile aircraft" data-testid="picker-aircraft">
      {AIRCRAFT.map((a) => {
        const on = value === a.id;
        return (
          <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? "" : a.id)} data-testid={`button-aircraft-${a.id}`}
            className={cn("flex flex-col items-center gap-1 rounded-xl border px-1.5 pt-2 pb-1.5 text-center hover-elevate",
              on ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground")}>
            <AircraftIcon type={a.id} className={cn("h-9 w-9", on ? "text-primary" : "")} />
            <span className="text-[11px] font-semibold leading-tight">{a.label}</span>
            <span className="text-[9.5px] leading-tight opacity-75">{a.example}</span>
          </button>
        );
      })}
    </div>
  );
}
