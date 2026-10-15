// Layover Today (Version 0, admins only): one screen for the airport you're at.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useSearch } from "@/pages/home";
import { BedDouble, ChevronRight, Clock, Compass, Heart, Loader2, PlaneLanding, Plane, RefreshCw, Star, Sunrise, Sunset, Users, Utensils, Wind } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AirportCheckInCard } from "@/lib/checkins";
import { PreviewBadge, PreviewGate, ago, errMsg } from "@/lib/preview";
import { cn } from "@/lib/utils";
import type { Metar, TodayPick, TodayResp } from "@shared/layover";

const CAT_COLOR: Record<string, string> = {
  VFR: "bg-emerald-600 text-white", MVFR: "bg-sky-600 text-white", IFR: "bg-red-600 text-white", LIFR: "bg-fuchsia-700 text-white",
};
const fmtTime = (ms: number | null | undefined, tz: string | null) => ms ? new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hour: "numeric", minute: "2-digit" }).format(ms) : "—";
const tzAbbr = (tz: string | null) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, timeZoneName: "short" }).formatToParts(Date.now()).find((p) => p.type === "timeZoneName")?.value || ""; } catch { return ""; } };
/** Hours between the field's clock and the phone's clock. */
const offsetFromYou = (tz: string | null) => {
  if (!tz) return null;
  const at = (zone?: string) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(Date.now()); const g = (t: string) => Number(p.find((x) => x.type === t)?.value); return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute")); };
  const h = Math.round(((at(tz) - at(undefined)) / 3600_000) * 2) / 2;
  return h;
};
const cToF = (c: number) => Math.round(c * 9 / 5 + 32);

function useClock() {
  const [, t] = useState(0);
  useEffect(() => { const i = setInterval(() => t((n) => n + 1), 20_000); return () => clearInterval(i); }, []);
}

export default function TodayPage() { return <PreviewGate><Today /></PreviewGate>; }

function Today() {
  useClock();
  const [code, setCode] = useState<string>(() => new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1)).get("icao")?.toUpperCase() || "");
  const [typed, setTyped] = useState("");
  const key = ["/api/preview/today", code];
  const { data, isLoading, error, isFetching, refetch } = useQuery<TodayResp>({
    queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/preview/today${code ? `?icao=${encodeURIComponent(code)}` : ""}`)).json(), staleTime: 60_000, retry: false,
  });
  const go = (c: string) => { const v = c.trim().toUpperCase(); if (v.length >= 3) { setCode(v); setTyped(""); } };

  return (
    <div className="space-y-4" data-testid="page-today">
      <header className="space-y-1">
        <PreviewBadge />
        <h1 className="text-xl font-semibold">Layover today</h1>
        <p className="text-sm text-muted-foreground">Everything for the field you're at, on one screen.</p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); go(typed); }} className="flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={4} placeholder={data?.icao ? `Not at ${data.icao}? Type the airport` : "Airport, e.g. TEB or KTEB"}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 font-code text-base uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70" data-testid="input-today-airport" aria-label="Airport" />
        <button type="submit" className="h-11 rounded-xl taxi-sign px-4 text-sm font-semibold hover-elevate disabled:opacity-60" disabled={typed.trim().length < 3} data-testid="button-today-go">Go</button>
      </form>
      {!!data?.recent?.length && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" data-testid="list-today-recent">
          {data.recent.map((c) => (
            <button key={c} type="button" onClick={() => go(c)} className={cn("h-8 shrink-0 rounded-full border px-3 font-code text-xs font-semibold", c === data.icao ? "border-primary bg-primary/15" : "border-border hover-elevate")} data-testid={`chip-today-${c}`}>{c}</button>
          ))}
        </div>
      )}

      {isLoading ? <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : error ? <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-today-error">{errMsg(error)}</p>
        : !data?.airport ? <NoAirport />
        : <Board d={data} refreshing={isFetching} onRefresh={() => { void queryClient.invalidateQueries({ queryKey: key }); void refetch(); }} />}
    </div>
  );
}

function NoAirport() {
  return (
    <div className="space-y-3" data-testid="today-empty">
      <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">Check in when you land, or type the airport above. Your latest briefing stop shows here too.</p>
      <AirportCheckInCard />
    </div>
  );
}

function Board({ d, refreshing, onRefresh }: { d: TodayResp; refreshing: boolean; onRefresh: () => void }) {
  const ap = d.airport!;
  const off = useMemo(() => offsetFromYou(d.tz), [d.tz]);
  const now = Date.now();
  const sunsetPast = !!d.sun?.set && d.sun.set < now;
  return (
    <div className="space-y-4">
      {/* field + clock */}
      <section className="overflow-hidden rounded-2xl bg-[#0B1222] text-white" data-testid="card-today-field">
        <div className="relative px-5 pb-4 pt-5">
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "18px 18px" }} aria-hidden />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-code text-3xl font-bold tracking-wider text-primary" data-testid="text-today-icao">{ap.icao}</p>
              <p className="mt-0.5 truncate text-sm font-semibold">{ap.name}</p>
              <p className="text-xs text-white/60">{[ap.city, ap.region, ap.country !== "US" ? ap.country : ""].filter(Boolean).join(", ")}</p>
            </div>
            <div className="text-right">
              <p className="font-code text-3xl font-bold tabular" data-testid="text-today-time">{fmtTime(now, d.tz)}</p>
              <p className="text-xs text-white/60">{tzAbbr(d.tz)} local{off ? ` · ${off > 0 ? "+" : ""}${off} h from you` : ""}</p>
            </div>
          </div>
          <p className="relative mt-3 text-xs text-white/70" data-testid="text-today-source">
            {d.checkedInAt ? <><PlaneLanding className="mr-1 inline h-3.5 w-3.5 text-primary" />Checked in {ago(d.checkedInAt)}</>
              : d.source === "briefing" ? <><Plane className="mr-1 inline h-3.5 w-3.5 text-primary" />From your latest briefing</>
              : <>Not checked in here</>}
          </p>
        </div>
        <div className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 text-sm">
          <div className="flex items-center gap-2 px-5 py-3"><Sunset className="h-4 w-4 text-primary" /><span><span className="block text-[11px] uppercase tracking-wider text-white/50">Sunset</span><span className="font-semibold tabular" data-testid="text-today-sunset">{d.sun?.set ? fmtTime(d.sun.set, d.tz) : "None today"}</span>{sunsetPast && <span className="ml-1 text-xs text-white/50">passed</span>}</span></div>
          <div className="flex items-center gap-2 px-5 py-3"><Sunrise className="h-4 w-4 text-primary" /><span><span className="block text-[11px] uppercase tracking-wider text-white/50">{d.sun?.nextRise && d.sun.rise && d.sun.nextRise === d.sun.rise ? "Sunrise" : "Sunrise tomorrow"}</span><span className="font-semibold tabular" data-testid="text-today-sunrise">{d.sun?.nextRise ? fmtTime(d.sun.nextRise, d.tz) : "None"}</span></span></div>
        </div>
      </section>

      <Weather m={d.metar} failed={d.metarError} tz={d.tz} refreshing={refreshing} onRefresh={onRefresh} />

      {!d.checkedInAt && <AirportCheckInCard />}

      {d.briefing && (
        <Section title="Your briefing here" icon={<Plane className="h-4 w-4" />} action={<Link href={`/brief/${d.briefing.id}`} className="text-xs font-semibold text-foreground underline underline-offset-2" data-testid="link-today-brief">Open</Link>} testid="card-today-brief">
          <p className="px-4 pb-1 text-xs text-muted-foreground">{d.briefing.title || "Briefing"} · {layoverLabel(d.briefing.layover, d.briefing.nights)}</p>
          {d.briefing.picks.length ? <Picks list={d.briefing.picks} /> : <p className="px-4 pb-3 text-sm text-muted-foreground">No picks at this stop yet.</p>}
        </Section>
      )}

      {(d.crewPicks.eat.length > 0 || d.crewPicks.do.length > 0) && (
        <Section title="Crew favorites nearby" icon={<Star className="h-4 w-4" />} action={<SeeAll icao={ap.icao} />} testid="card-today-crew">
          <Picks list={[...d.crewPicks.eat, ...d.crewPicks.do]} />
        </Section>
      )}

      {d.favorites.length > 0 && (
        <Section title="Your favorites here" icon={<Heart className="h-4 w-4" />} testid="card-today-favorites"><Picks list={d.favorites} /></Section>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={`/meetup?icao=${ap.icao}`} className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-4 hover-elevate" data-testid="link-today-meetup">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><Users className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Crew meetup</span>
            <span className="block text-xs text-muted-foreground" data-testid="text-today-meetup">
              {d.meetup.mine ? (d.meetup.others ? `${d.meetup.others} other crew${d.meetup.others > 1 ? "s" : ""} here tonight` : "You're posted. No one else yet.") : "Going out tonight? Let crews here know."}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/rate" className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-4 hover-elevate" data-testid="link-today-rate">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><Star className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Rate a spot</span>
            <span className="block text-xs text-muted-foreground" data-testid="text-today-rate">{d.toRate ? `${d.toRate} place${d.toRate > 1 ? "s" : ""} here waiting for your rating` : "Been somewhere? Rate it for the next crew."}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}

function SeeAll({ icao }: { icao: string }) {
  const [, set] = useSearch();
  const [, navigate] = useLocation();
  return <button type="button" onClick={() => { set({ category: "eat", route: icao, browse: true, view: "list" }); navigate("/"); }} className="text-xs font-semibold text-foreground underline underline-offset-2" data-testid="link-today-search">See all</button>;
}

const layoverLabel = (l: string, n: number | null) => ({ quick: "Quick turn", hours: "A few hours", overnight: "Overnight", multi: `${n || 2} nights` } as Record<string, string>)[l] || l;

function Weather({ m, failed, tz, refreshing, onRefresh }: { m: Metar | null; failed: boolean; tz: string | null; refreshing: boolean; onRefresh: () => void }) {
  const wind = m ? (m.windKt === 0 ? "Calm" : m.windKt == null ? "—" : `${m.windDir === "VRB" ? "Variable" : m.windDir != null ? `${String(m.windDir).padStart(3, "0")}°` : ""} ${m.windKt} kt${m.gustKt ? ` G${m.gustKt}` : ""}`) : "";
  return (
    <section className="rounded-2xl border border-card-border bg-card" data-testid="card-today-weather">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Wind className="h-4 w-4" />Weather</h2>
        <button type="button" onClick={onRefresh} className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover-elevate" aria-label="Refresh weather" data-testid="button-today-refresh"><RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />Refresh</button>
      </div>
      {!m ? <p className="px-4 pb-4 pt-1 text-sm text-muted-foreground" data-testid="text-today-nometar">{failed ? "Weather service isn't answering right now. Try again in a minute." : "No weather station reports near this field."}</p> : (
        <div className="px-4 pb-4 pt-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {m.flightCat && <span className={cn("rounded-md px-2 py-0.5 font-code text-xs font-bold", CAT_COLOR[m.flightCat])} data-testid="badge-today-fltcat">{m.flightCat}</span>}
            {m.tempC != null && <span className="text-2xl font-semibold tabular" data-testid="text-today-temp">{cToF(m.tempC)}°F <span className="text-sm font-normal text-muted-foreground">{Math.round(m.tempC)}°C</span></span>}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Wind</dt><dd className="font-semibold tabular" data-testid="text-today-wind">{wind}</dd></div>
            <div><dt className="text-muted-foreground">Visibility</dt><dd className="font-semibold tabular">{m.visibility ? `${m.visibility} sm` : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Ceiling</dt><dd className="font-semibold tabular">{m.ceilingFt != null ? `${m.ceilingFt.toLocaleString()} ft` : "None"}</dd></div>
          </dl>
          <p className="mt-3 break-words rounded-lg bg-muted px-2.5 py-2 font-code text-[11px] leading-relaxed" data-testid="text-today-metar">{m.raw}</p>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" />{m.station}{m.stationMiles >= 1 ? `, ${m.stationMiles} mi away` : ""} · observed {ago(m.observedAt)} ({fmtTime(m.observedAt, tz)} local) · aviationweather.gov</p>
        </div>
      )}
    </section>
  );
}

function Section({ title, icon, action, children, testid }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; testid: string }) {
  return (
    <section className="rounded-2xl border border-card-border bg-card" data-testid={testid}>
      <div className="flex items-center justify-between px-4 pb-2 pt-3"><h2 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2>{action}</div>
      {children}
    </section>
  );
}

const CAT_ICON: Record<string, typeof Utensils> = { eat: Utensils, do: Compass, stay: BedDouble, fbo: PlaneLanding };
function Picks({ list }: { list: TodayPick[] }) {
  return (
    <ul className="divide-y divide-border border-t border-border">
      {list.map((p) => {
        const Icon = CAT_ICON[p.category] || Star;
        return (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Link href={`/spot/${p.id}`} className="min-w-0 flex-1" data-testid={`link-today-spot-${p.id}`}>
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">{p.avgRating != null ? `${p.avgRating.toFixed(1)} ★ · ${p.reviewCount} rating${p.reviewCount === 1 ? "" : "s"}` : "No ratings yet"}{p.milesFromField ? ` · ${p.milesFromField} mi` : ""}</span>
            </Link>
            {p.rated ? <span className="text-[11px] text-muted-foreground">Rated</span>
              : <Link href={`/spot/${p.id}?rate=1`} className="inline-flex h-8 shrink-0 items-center rounded-full border border-border px-3 text-xs font-semibold hover-elevate" data-testid={`link-today-rate-${p.id}`}>Rate</Link>}
          </li>
        );
      })}
    </ul>
  );
}
