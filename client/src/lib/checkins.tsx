import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MapPinCheck, Loader2, Trash2, PlaneLanding } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { getPositionFix } from "@/lib/geo";
import { drawStaticMap, type MapPin } from "@/lib/staticMap";
import { cn } from "@/lib/utils";
import type { CheckIn, MapDot } from "@shared/checkins";

export const DOT = { added: "#E8A317", checkin: "#0E9F8E", airport: "#0B1222" } as const;
const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*?)".*$/, "$1");
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

export function useMyCheckins() {
  const { me } = useAuth();
  return useQuery<CheckIn[]>({ queryKey: ["/api/me/checkins"], enabled: !!me, staleTime: 30_000 });
}
const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/api/me/checkins"] }); queryClient.invalidateQueries({ queryKey: ["/api/me/map"] }); };

async function checkIn(target: { spotId?: number; icao?: string }) {
  const fix = await getPositionFix();
  return (await apiRequest("POST", "/api/checkins", { ...target, lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy) })).json() as Promise<{ already: boolean; createdAt: number }>;
}

/** "I've been here" on a listing, verified with the phone's location. */
export function CheckInButton({ spotId, name }: { spotId: number; name: string }) {
  const { me, openAuth } = useAuth();
  const { toast } = useToast();
  const { data } = useMyCheckins();
  const mine = (data || []).filter((c) => c.spotId === spotId);
  const m = useMutation({
    mutationFn: () => checkIn({ spotId }),
    onSuccess: (r) => { refresh(); toast({ title: r.already ? "Already checked in today" : `Checked in at ${name}` }); },
    onError: (e) => toast({ title: "Couldn't check in", description: errText(e), variant: "destructive" }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="checkin-spot">
      <button type="button" onClick={() => (me ? m.mutate() : openAuth())} disabled={m.isPending} data-testid="button-checkin"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#0E9F8E]/50 px-3.5 text-sm font-semibold text-[#0B7A6E] hover-elevate disabled:opacity-60 dark:text-[#5FD4C6]">
        {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinCheck className="h-4 w-4" />}
        {m.isPending ? "Checking your location…" : "I'm here · check in"}
      </button>
      {mine.length > 0 && <span className="text-xs text-muted-foreground" data-testid="text-checkin-last">You checked in {mine.length > 1 ? `${mine.length} times, last ` : ""}{day(mine[0].createdAt)}</span>}
    </div>
  );
}

/** Logbook card: check in at whichever airport you're at right now. */
export function AirportCheckInCard() {
  const { toast } = useToast();
  const [state, setState] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  async function go() {
    setState({ busy: true, msg: "" });
    try {
      const fix = await getPositionFix();
      const near = await (await apiRequest("GET", `/api/airports/nearest?lat=${fix.lat}&lon=${fix.lng}`)).json() as { icao: string; name: string; miles: number }[];
      const ap = near[0];
      if (!ap || ap.miles > 3) { setState({ busy: false, msg: ap ? `Nearest airport is ${ap.icao}, ${ap.miles} mi away. Check in when you're on or near the field.` : "No airport nearby." }); return; }
      const r = (await (await apiRequest("POST", "/api/checkins", { icao: ap.icao, lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy) })).json()) as { already: boolean };
      refresh();
      toast({ title: r.already ? `Already checked in at ${ap.icao} today` : `Checked in at ${ap.icao}`, description: ap.name });
      setState({ busy: false, msg: "" });
    } catch (e) { setState({ busy: false, msg: errText(e) }); }
  }
  return (
    <div className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-airport-checkin">
      <button type="button" onClick={go} disabled={state.busy} className="flex w-full items-center gap-3 text-left disabled:opacity-70" data-testid="button-airport-checkin">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0E9F8E]/15 text-[#0B7A6E] dark:text-[#5FD4C6]">{state.busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlaneLanding className="h-5 w-5" />}</span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{state.busy ? "Finding your airport…" : "Check in at this airport"}</span>
          <span className="block text-xs text-muted-foreground">Logs the field you're at, verified by your location. Only you see your check-ins.</span></span>
      </button>
      {state.msg && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-airport-checkin-msg">{state.msg}</p>}
    </div>
  );
}

function DotMap({ dots, height = 240 }: { dots: MapDot[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null);
  const pins: MapPin[] = dots.map((d) => ({ lat: d.lat, lng: d.lng, label: "", kind: d.kind === "airport" ? "fbo" : "eat", dot: DOT[d.kind] }));
  const sig = JSON.stringify(pins);
  useEffect(() => {
    const c = ref.current, w = wrap.current;
    if (!c || !w) return;
    let alive = true;
    const draw = () => { if (alive) drawStaticMap(c, pins, w.clientWidth, height); };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(w);
    return () => { alive = false; ro.disconnect(); };
  }, [sig, height]); // eslint-disable-line
  return (
    <div ref={wrap} className="w-full overflow-hidden rounded-xl border border-border bg-muted" style={{ height }}>
      <canvas ref={ref} style={{ width: "100%", height }} role="img" aria-label="Map of places added and checked in" />
    </div>
  );
}
const Legend = ({ color, label, n }: { color: string; label: string; n: number }) => (
  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: color }} />{label} <span className="font-code tabular">{n}</span></span>
);

/** Profile map: places you added (gold) and places you've checked in at (teal), airports in navy. */
export function ProfileMap({ userId, own }: { userId?: number; own?: boolean }) {
  const url = own ? "/api/me/map" : `/api/crew/${userId}/map`;
  const { data } = useQuery<{ added: MapDot[]; checkins: MapDot[] }>({ queryKey: [url], staleTime: 60_000 });
  const added = data?.added || [], ck = data?.checkins || [];
  const ckSpots = ck.filter((c) => c.kind === "checkin"), ckAps = ck.filter((c) => c.kind === "airport");
  if (!data || (!added.length && !ck.length)) return own ? (
    <section className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="section-profile-map-empty">Your map fills in as you add places and check in.</section>
  ) : null;
  return (
    <section className="space-y-2 rounded-2xl border border-card-border bg-card p-4" data-testid="section-profile-map">
      <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">{own ? "Your map" : "Places added"}</h2>
        {own && <span className="text-[11px] text-muted-foreground">Check-ins are private</span>}</div>
      <DotMap dots={[...ckAps, ...added, ...ckSpots]} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legend color={DOT.added} label="Added" n={added.length} />
        {own && <Legend color={DOT.checkin} label="Checked in" n={ckSpots.length} />}
        {own && <Legend color={DOT.airport} label="Airports" n={ckAps.length} />}
      </div>
    </section>
  );
}

/** Your recent check-ins, with delete. */
export function CheckInList() {
  const { data } = useMyCheckins();
  const del = useMutation({ mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/checkins/${id}`)).json(), onSuccess: refresh });
  const [all, setAll] = useState(false);
  if (!data?.length) return null;
  const list = all ? data : data.slice(0, 5);
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="section-checkins">
      <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">Check-ins</h2>
        <span className="text-[11px] text-muted-foreground">{(() => { const n = new Set(data.map((c) => c.icao)).size; return `${n} ${n === 1 ? "airport" : "airports"} · ${data.length} total`; })()}</span></div>
      <ul className="mt-2 divide-y divide-border">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2" data-testid={`row-checkin-${c.id}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.spotId ? DOT.checkin : DOT.airport }} />
            <div className="min-w-0 flex-1">
              {c.spotId ? <Link href={`/spot/${c.spotId}`} className="block truncate text-sm font-medium hover:underline">{c.spotName || "Listing"}</Link> : <p className="text-sm font-medium">At the airport</p>}
              <p className="text-[11px] text-muted-foreground"><span className="font-code">{c.icao}</span> · {day(c.createdAt)}</p>
            </div>
            <button type="button" onClick={() => del.mutate(c.id)} aria-label="Delete check-in" className={cn("grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover-elevate")} data-testid={`button-delete-checkin-${c.id}`}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      {data.length > 5 && <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs font-medium text-primary" data-testid="button-checkins-all">{all ? "Show fewer" : `Show all ${data.length}`}</button>}
    </section>
  );
}
