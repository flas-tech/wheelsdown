// Home (trip preview): the Spots search opens first, and this card at the top shows the field you're at:
// nearest airport by location (asks if the phone hasn't decided; never when it's been denied), else the last
// airport you picked. Tapping it opens Layover today on that airport.
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Loader2, PlaneLanding, Users } from "lucide-react";
import type { Meetup, TodayResp } from "@shared/layover";
import { apiRequest } from "@/lib/queryClient";
import { getPosition, type NearAirport } from "@/lib/geo";
import { RampHere } from "@/lib/rampChecks";
import { cn } from "@/lib/utils";

const LAST = "wd-today-last";
const CAT: Record<string, string> = { VFR: "bg-emerald-600", MVFR: "bg-sky-600", IFR: "bg-red-600", LIFR: "bg-fuchsia-700" };
const cToF = (c: number) => Math.round((c * 9) / 5 + 32);

export function TodayCard() {
  const [code, setCode] = useState<string | null>(null); // null while finding where you are
  useEffect(() => {
    let live = true;
    const last = (() => { try { return localStorage.getItem(LAST) || ""; } catch { return ""; } })();
    const timer = setTimeout(() => { if (live) setCode((c) => c ?? last); }, 5000);
    (async () => {
      try {
        const perms = (navigator as any).permissions;
        const st = perms?.query ? await perms.query({ name: "geolocation" }).then((p: { state: string }) => p.state).catch(() => "") : "";
        if (st === "denied") throw 0;
        const pos = await getPosition();
        const near = (await (await apiRequest("GET", `/api/airports/nearest?lat=${pos.lat}&lon=${pos.lng}`)).json()) as NearAirport[];
        if (live) setCode(near[0]?.icao || last);
      } catch { if (live) setCode((c) => c ?? last); }
      finally { clearTimeout(timer); }
    })();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  // same cache as Layover today, so opening it is instant
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const pick = (e: FormEvent) => {
    e.preventDefault();
    const c = typed.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(c)) return;
    try { localStorage.setItem(LAST, c); } catch { /* private mode */ }
    setTyping(false); setCode(c);
  };
  const { data, isError } = useQuery<TodayResp>({
    queryKey: ["/api/preview/today", code || ""], enabled: code !== null, staleTime: 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/preview/today${code ? `?icao=${encodeURIComponent(code)}` : ""}`)).json(),
  });
  const icao = data?.airport?.icao || "";
  const { data: plans } = useQuery<{ byIcao: Record<string, Meetup[]> }>({ queryKey: [`/api/preview/crewup-at?icaos=${icao}`], enabled: !!icao, staleTime: 30_000, retry: false });
  const nPlans = plans?.byIcao[icao]?.length || 0;

  // No location (or it's slow): type the field instead of waiting on the spinner
  if (typing) return (
    <form onSubmit={pick} className="flex items-center gap-2 rounded-2xl bg-[#0b1220] p-3 text-white" data-testid="form-home-today-field">
      <PlaneLanding className="ml-1 h-5 w-5 shrink-0 text-primary" />
      <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))} placeholder="Field you're at (KTEB)"
        autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-label="Airport code" data-testid="input-home-today-field"
        className="min-w-0 flex-1 h-10 rounded-lg bg-white/10 px-3 font-code text-base tracking-wider placeholder:font-sans placeholder:tracking-normal placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-primary" />
      <button type="submit" disabled={typed.length < 3} className="h-10 shrink-0 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-home-today-go">Go</button>
      <button type="button" onClick={() => setTyping(false)} className="h-10 shrink-0 px-1.5 text-xs text-white/60" data-testid="button-home-today-cancel">Cancel</button>
    </form>
  );
  if (!isError && (code === null || (!data && code !== ""))) return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#0b1220] p-4 text-white/80" data-testid="card-home-today-loading">
      <Loader2 className="h-5 w-5 shrink-0 animate-spin" /><span className="flex-1 text-sm">Finding the nearest airport…</span>
      <button type="button" onClick={() => setTyping(true)} className="shrink-0 text-xs font-semibold text-primary" data-testid="button-home-today-type">Type a field</button>
    </div>
  );
  if (!data?.airport) return (
    <button type="button" onClick={() => setTyping(true)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left hover-elevate" data-testid="card-home-today">
      <PlaneLanding className="h-5 w-5 text-primary" />
      <span className="flex-1 text-sm font-semibold">Layover today: type the field you're at</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
  const ap = data.airport, m = data.metar;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: data.tz || undefined, hour: "numeric", minute: "2-digit" }).format(Date.now());
  return (
    <div className="overflow-hidden rounded-2xl bg-[#0b1220]">
    <Link href={`/today?icao=${ap.icao}`} className="block p-4 text-white hover-elevate" data-testid="card-home-today">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">At the field now</p>
          <p className="mt-0.5 flex items-baseline gap-2"><span className="font-code text-2xl font-bold tracking-wider text-primary" data-testid="text-home-today-icao">{ap.icao}</span>
            <span className="truncate text-sm font-semibold">{ap.name}</span></p>
          <p className="truncate text-xs text-white/60">{[ap.city, ap.region].filter(Boolean).join(", ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-code text-lg font-bold">{time}</p>
          {m && <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs">{m.flightCat && <span className={cn("rounded px-1.5 font-code text-[10px] font-bold", CAT[m.flightCat])}>{m.flightCat}</span>}{m.tempC != null && <span>{cToF(m.tempC)}°F</span>}</p>}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-white/70">
          {nPlans > 0 ? <><Users className="h-3.5 w-3.5 text-primary" />{nPlans} crew plan{nPlans === 1 ? "" : "s"} here</> : "Weather, sunset, crew picks and your plans"}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">Layover today<ChevronRight className="h-4 w-4" /></span>
      </div>
    </Link>
    <RampHere icao={ap.icao} />
    </div>
  );
}
