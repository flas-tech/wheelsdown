// Crew Up (was "Crew meetup"): layover plans at the airport level, seen only by people in each other's My Crew.
// No strangers: you see a plan only when the host is in your crew. Posts end by themselves.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BadgeCheck, CalendarClock, Clock, Eye, Flag, Loader2, LogOut, MapPin, Plus, ShieldCheck, UserCheck, UserPlus, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CrewAvatar } from "@/lib/aircraft";
import { PreviewBadge, PreviewGate, errMsg, left } from "@/lib/preview";
import { ThreadButton } from "@/lib/dm";
import { InviteCrewCard, useMyCrew } from "@/lib/mycrew";
import { markCrewUpSeen } from "@/lib/tabDots";
import { crewUpHref, crewUpPrefill, fmtArrive, type TripResp, type TripStop } from "@/lib/tripNav";
import { useTrip } from "@/lib/experience";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { findTailNumbers } from "@shared/tailNumber";
import { MEETUP_PRIVACY, MEETUP_RULES, meetupNoteProblem, type Meetup, type MeetupPerson, type MeetupResp } from "@shared/layover";
import type { SpotWithStats } from "@shared/schema";
import { stopPins, type BriefFull } from "@/lib/briefPdf";

export default function MeetupPage() { return <PreviewGate><MeetupBoard /></PreviewGate>; }

const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/preview/") });

const SOON = 5 * 60_000;
/** Airport-local time now, rounded up to the next 15 minutes ("HH:MM"), and the date that lands on. */
export const nowSlot = (tz: string | null) => {
  const t = Math.ceil(Date.now() / 900_000) * 900_000;
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
  return { time: hm, date: new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(t) };
};
const localDate = (tz: string | null, t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
const fmtStart = (m: { startsAt: number; tz: string | null }) => new Intl.DateTimeFormat(undefined, { timeZone: m.tz || undefined, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(m.startsAt);
const upcoming = (m: Meetup) => m.startsAt > Date.now() + SOON;
/** "Wed, Oct 22, 7:00 PM local" for later plans, "8 h left" once they've started. */
function When({ m }: { m: Meetup }) {
  return upcoming(m)
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground" data-testid={`text-meetup-when-${m.id}`}><CalendarClock className="h-3.5 w-3.5 text-primary" />{fmtStart(m)} local</span>
    : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-meetup-when-${m.id}`}><Clock className="h-3.5 w-3.5" />{left(m.expiresAt)}</span>;
}

function MeetupBoard() {
  const [code, setCode] = useState<string>(() => new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1)).get("icao")?.toUpperCase() || "");
  const [typed, setTyped] = useState("");
  // from a briefing stop ("Crew Up here"): its date, time and how long the layover is
  const [pre, setPre] = useState(crewUpPrefill);
  useEffect(() => { // read once: drop date/time/hours from the address so a later visit doesn't fill them in again
    const u = new URL(window.location.href);
    if (["date", "time", "hours"].some((k) => u.searchParams.has(k))) { for (const k of ["date", "time", "hours"]) u.searchParams.delete(k); history.replaceState(history.state, "", u.toString()); }
  }, []);
  const trip = useTrip();
  const { data: trips } = useQuery<TripResp>({ queryKey: ["/api/preview/trip"], enabled: trip, staleTime: 60_000, retry: false });
  const fromBriefs = (trips?.coming || []).slice(0, 6);
  const pickStop = (s: TripStop) => { const u = new URL(`http://x${crewUpHref(s)}`); setPre({ date: u.searchParams.get("date"), time: u.searchParams.get("time"), hours: Number(u.searchParams.get("hours")) || null }); setCode(s.icao); setMore(true); };
  const { data, isLoading, error } = useQuery<MeetupResp>({
    queryKey: ["/api/preview/meetups", code], queryFn: async () => (await apiRequest("GET", `/api/preview/meetups${code ? `?icao=${encodeURIComponent(code)}` : ""}`)).json(), staleTime: 20_000, refetchInterval: 60_000, retry: false,
  });
  const go = (c: string) => { const v = c.trim().toUpperCase(); if (v.length >= 3) { setCode(v); setTyped(""); setPre({ date: null, time: null, hours: null }); } };
  // opening Crew Up clears its red dot (#51)
  useEffect(() => { if (data) markCrewUpSeen(); }, [data]);
  const [more, setMore] = useState(() => !!crewUpPrefill().hours);
  useEffect(() => { if (!pre.date && !pre.hours) setMore(false); }, [data?.icao]); // eslint-disable-line
  const mineHere = data?.icao ? data.mine.filter((m) => m.icao === data.icao) : [];
  // four-tab preview: New plan / Your plans tabs; a notification opens the plan it's about (?plan=ID)
  const qs = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
  const planId = Number(qs.get("plan")) || null;
  const [tab, setTab] = useState<"new" | "plans">(planId || qs.get("tab") === "plans" ? "plans" : "new");
  const { data: all } = useQuery<{ plans: Meetup[] }>({ queryKey: ["/api/preview/crewup-all"], enabled: trip, staleTime: 20_000, refetchInterval: 60_000, retry: false });
  const plans = all?.plans || [];
  // red dot while anything is planned: every plan listed is live until it ends (its date and time plus how long it runs)
  const dot = plans.some((m) => m.expiresAt > Date.now());
  const full = (data?.mine.length || 0) >= MEETUP_RULES.maxPlans;

  return (
    <div className="space-y-4" data-testid="page-meetup">
      <header className="space-y-1">
        <PreviewBadge />
        <h1 className="text-xl font-semibold">Crew Up</h1>
        <p className="text-sm text-muted-foreground">Make layover plans with your crew, tonight or for a trip coming up. Only people in your <Link href="/mycrew" className="font-medium text-foreground underline underline-offset-2">My Crew</Link> see them, or just the ones you pick. Airport level only, and they end by themselves.</p>
      </header>

      {trip && (
        <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-card p-1" role="tablist" data-testid="tabs-crewup">
          {([["new", "New plan"], ["plans", "Your plans"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-crewup-${k}`}
              className={cn("relative h-9 rounded-full text-sm font-semibold", tab === k ? "bg-foreground text-background" : "text-muted-foreground hover-elevate")}>
              {l}{k === "plans" && plans.length > 0 && <span className="ml-1 font-code text-xs opacity-70">{plans.length}</span>}
              {k === "plans" && dot && <span className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-red-500" aria-label="Plans coming up" data-testid="dot-crewup-plans" />}
            </button>
          ))}
        </div>
      )}

      {trip && tab === "plans" ? <YourPlans plans={plans} loading={!all} focus={planId} onNew={() => setTab("new")} /> : <>
      <form onSubmit={(e) => { e.preventDefault(); go(typed); }} className="flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={4} placeholder={data?.icao ? `Not at ${data.icao}? Type the airport` : "Which airport? e.g. TEB"}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 font-code text-base uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70" data-testid="input-meetup-airport" aria-label="Airport" />
        <button type="submit" className="h-11 rounded-xl taxi-sign px-4 text-sm font-semibold hover-elevate disabled:opacity-60" disabled={typed.trim().length < 3} data-testid="button-meetup-go">Go</button>
      </form>

      {fromBriefs.length > 0 && (
        <section className="space-y-1.5" data-testid="section-meetup-briefs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{trip ? "From your trip sheets" : "From your briefs"}</h2>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
            {fromBriefs.map((s) => (
              <button key={`${s.briefId}-${s.stopIndex}`} type="button" onClick={() => pickStop(s)} data-testid={`chip-meetup-brief-${s.icao}`}
                className={cn("shrink-0 rounded-xl border px-3 py-2 text-left hover-elevate", data?.icao === s.icao ? "border-primary bg-primary/10" : "border-border bg-card")}>
                <span className="block font-code text-sm font-bold">{s.icao}</span>
                <span className="block text-[11px] text-muted-foreground">{s.arriveDate ? fmtArrive(s) : "No date yet"}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {isLoading ? <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : error ? <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-meetup-error">{errMsg(error)}</p>
        : !data ? null : <>
          {data.crewCount === 0 && <p className="rounded-2xl border border-primary/50 bg-primary/5 p-4 text-sm" data-testid="text-meetup-nocrew"><span className="font-semibold">Add your crew first.</span> <span className="text-muted-foreground">Crew Up plans are only seen by people in your crew, so nobody sees yours until you've added someone and they've accepted.</span></p>}
          {!trip && data.mine.length > 0 && (
            <section className="space-y-2" data-testid="section-meetup-mine">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your plans</h2>
              <ul className="space-y-2">{data.mine.map((m) => <li key={m.id}><Posted mine={m} /></li>)}</ul>
            </section>
          )}
          {!data.icao ? <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-meetup-empty">Type the airport you're at, or where you're headed, to make plans with your crew there.</p>
            : <>
              {full ? <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-meetup-full">You have {MEETUP_RULES.maxPlans} plans posted. End one to make another.</p>
                : mineHere.length && !more ? (
                  <button type="button" onClick={() => setMore(true)} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-border bg-card text-sm font-semibold hover-elevate" data-testid="button-meetup-another">
                    <Plus className="h-4 w-4" />Make another plan at <span className="font-code">{data.icao}</span>
                  </button>
                ) : <Compose key={`${data.icao}-${pre.date}-${pre.time}-${pre.hours}`} d={data} pre={pre} onPosted={() => { setMore(false); setPre({ date: null, time: null, hours: null }); }} />}
              {!trip && <CrewHere d={data} />}
            </>}
          {!trip && data.crewElsewhere.length > 0 && (
            <section className="space-y-2" data-testid="section-crew-elsewhere">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your crew at other airports</h2>
              <ul className="space-y-2">{data.crewElsewhere.map((m) => <li key={m.id}><Other m={m} showIcao /></li>)}</ul>
            </section>
          )}
          <InviteCrewCard compact crewUp />
        </>}
      </>}
    </div>
  );
}

/** Four-tab preview: every live plan you can see, yours and your crew's, soonest first. */
function YourPlans({ plans, loading, focus, onNew }: { plans: Meetup[]; loading: boolean; focus: number | null; onNew: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (focus && ref.current) ref.current.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus, plans.length]);
  if (loading) return <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!plans.length) return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-crewup-noplans">
      No plans yet. <button type="button" onClick={onNew} className="font-semibold text-foreground underline underline-offset-2">Make a new plan</button> and your crew sees it here.
    </div>
  );
  return (
    <ul className="space-y-2" data-testid="list-crewup-plans">
      {plans.map((m) => (
        <li key={m.id} ref={m.id === focus ? ref : undefined} className={cn("rounded-2xl", m.id === focus && "ring-2 ring-primary ring-offset-2 ring-offset-background")} data-testid={`plan-${m.id}`}>
          {m.mine ? <Posted mine={m} /> : <Other m={m} showIcao />}
        </li>
      ))}
    </ul>
  );
}

function Compose({ d, pre, onPosted }: { d: MeetupResp; pre?: { date: string | null; time: string | null; hours: number | null }; onPosted?: () => void }) {
  const icao = d.icao!;
  const { me } = useAuth();
  const { toast } = useToast();
  const crew = useMyCrew().data?.crew || [];
  const today = localDate(d.tz);
  // 7 PM local by default: today, or tomorrow once it's already evening there
  const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: d.tz || undefined, hour: "numeric", hourCycle: "h23" }).format(Date.now())) % 24;
  const preDate = pre?.date && pre.date >= today ? pre.date : null; // a stop's arrival date, if it's still ahead
  const [later, setLater] = useState(!!preDate && (preDate > today || !!pre?.time));
  const trip = useTrip();
  // four-tab preview: date and time start at now (airport local), or the stop's date at the current time
  const [date, setDate] = useState(() => preDate || (trip ? nowSlot(d.tz).date : localHour >= 18 ? localDate(d.tz, Date.now() + 86400_000) : today));
  const [time, setTime] = useState(pre?.time && preDate ? pre.time : trip ? nowSlot(d.tz).time : "19:00");
  const [pickAll, setPickAll] = useState(!trip); // four-tab preview: always pick who sees it (Select all is there)
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const [note, setNote] = useState("");
  const [hours, setHours] = useState<number>(() => ((MEETUP_RULES.hours as readonly number[]).includes(pre?.hours || 0) ? pre!.hours! : MEETUP_RULES.defaultHours));
  const [spotId, setSpotId] = useState<number | null>(null);
  const [place, setPlace] = useState(""); // typed place, when it isn't a listing
  // places already on your trip sheets at this airport go first in the list (hotels aren't meeting places)
  const { data: sheets } = useQuery<{ id: number; stops: { icao: string }[] }[]>({ queryKey: ["/api/briefings"], enabled: trip, staleTime: 60_000 });
  const sheetIds = (sheets || []).filter((b) => b.stops.some((x) => x.icao === icao)).map((b) => b.id).slice(0, 6);
  const full = useQueries({ queries: sheetIds.map((bid) => ({ queryKey: ["/api/briefings", String(bid)], staleTime: 60_000 })) }).map((q) => q.data as BriefFull | undefined);
  const onSheet: SpotWithStats[] = [];
  for (const b of full) for (const st of b?.stops || []) if (st.icao === icao) for (const n of stopPins(st).numbered)
    if (n.spot.category !== "stay" && !onSheet.some((x) => x.id === n.spot.id || x.name === n.spot.name)) onSheet.push(n.spot);
  const { data: places } = useQuery<{ spots: SpotWithStats[] }>({ queryKey: ["/api/search", icao], queryFn: async () => (await apiRequest("GET", `/api/search?route=${icao}`)).json(), staleTime: 300_000 });
  const options = (places?.spots || []).filter((s) => s.icao === icao && (s.category === "eat" || s.category === "do" || s.category === "fbo")).sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).slice(0, 25);
  const tails = findTailNumbers(note).length > 0;
  const priv = meetupNoteProblem(note);
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/preview/meetups", { icao, note: note.trim(), hours, spotId, ...(spotId ? {} : { place: place.trim() }), ...(later ? { startDate: date, startTime: time } : {}), viewers: pickAll ? null : picked })).json(),
    onSuccess: () => {
      toast({ title: pickAll ? `Posted to your crew at ${icao}` : `Shared with ${picked.length} of your crew at ${icao}`, description: later ? `Starts ${date} at ${time} local, for ${hours} hours.` : `Ends in ${hours} hours, or when you end it.` });
      setNote(""); setPlace(""); setLater(false); onPosted?.(); void refresh();
    },
    onError: (e) => toast({ title: "Couldn't post", description: errMsg(e), variant: "destructive" }),
  });
  const placeBad = !!place && (findTailNumbers(place).length > 0 || !!meetupNoteProblem(place));
  const blocked = placeBad || tails || !!priv || note.length > MEETUP_RULES.noteMax || (d.requireCheckin && !d.verifiedHere && !later) || (!pickAll && !picked.length) || (later && (!date || !time));
  const maxDate = localDate(d.tz, Date.now() + MEETUP_RULES.maxDaysAhead * 86400_000);
  const chip = (on: boolean) => cn("h-9 rounded-full border px-3.5 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover-elevate");
  return (
    <section className="space-y-4 rounded-2xl border border-card-border bg-card p-4" data-testid="card-meetup-compose">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><Users className="h-5 w-5" /></span>
        <div>
          <h2 className="text-base font-semibold">Plans at <span className="font-code">{icao}</span></h2>
          <p className="text-xs text-muted-foreground">{trip ? "Tonight or a trip coming up. Only the crew you pick see them." : "Tonight or a trip coming up. Your crew sees them, or only the people you pick. Nobody outside your crew does."}</p>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">When</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setLater(false)} className={chip(!later)} data-testid="chip-meetup-now">Now</button>
          <button type="button" onClick={() => setLater(true)} className={chip(later)} data-testid="chip-meetup-later">Later</button>
        </div>
        {later && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input type="date" value={date} min={today} max={maxDate} onChange={(e) => setDate(e.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base" data-testid="input-meetup-date" aria-label="Date" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base" data-testid="input-meetup-time" aria-label="Time" />
            <p className="col-span-2 text-[11px] text-muted-foreground">Local time at {icao}. Up to {MEETUP_RULES.maxDaysAhead} days ahead.</p>
          </div>
        )}
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">A short note (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={MEETUP_RULES.noteMax + 20} placeholder="Dinner around 7? Open to ideas."
          className="mt-1 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-base" data-testid="input-meetup-note" />
        <span className="mt-0.5 flex justify-between text-[11px] text-muted-foreground"><span>{tails ? <span className="text-destructive">Tail numbers aren't allowed. Use the type instead (a CJ3).</span> : priv ? <span className="text-destructive">{priv}</span> : MEETUP_PRIVACY}</span><span className="tabular">{note.length}/{MEETUP_RULES.noteMax}</span></span>
      </label>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Around for</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {MEETUP_RULES.hours.map((h) => (
            <button key={h} type="button" onClick={() => setHours(h)} className={chip(hours === h)} data-testid={`chip-meetup-hours-${h}`}>{h} h</button>
          ))}
        </div>
      </div>
      {trip ? (
        <div data-testid="meetup-place">
          <span className="text-xs font-medium text-muted-foreground">Meet at (optional, public places only)</span>
          <select value={spotId ?? (place && onSheet.some((x) => x.id < 0 && x.name === place) ? `p:${place}` : "")} onChange={(e) => {
            const v = e.target.value;
            if (!v) { setSpotId(null); return; }
            if (v.startsWith("p:")) { setSpotId(null); setPlace(v.slice(2)); } else { setSpotId(Number(v)); setPlace(""); }
          }} className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-base" data-testid="select-meetup-spot">
            <option value="">{place ? "Typed below" : "Pick a spot, or type one below"}</option>
            {onSheet.length > 0 && <optgroup label="On your trip sheet">
              {onSheet.map((s) => <option key={`t${s.id}`} value={s.id > 0 ? s.id : `p:${s.name}`}>{s.name}</option>)}
            </optgroup>}
            <optgroup label={onSheet.length ? `More at ${icao}` : `Spots at ${icao}`}>
              {options.filter((s) => !onSheet.some((x) => x.id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.avgRating != null ? ` · ${s.avgRating.toFixed(1)}★` : ""}</option>)}
            </optgroup>
          </select>
          <input value={place} onChange={(e) => { setPlace(e.target.value); if (e.target.value) setSpotId(null); }} maxLength={80} placeholder="Or type a place, e.g. the bar at Cafe Nove"
            className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-base" data-testid="input-meetup-place" />
          {placeBad && <p className="mt-1 text-[11px] text-destructive">{findTailNumbers(place).length ? "Tail numbers aren't allowed." : meetupNoteProblem(place)}</p>}
        </div>
      ) : (
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Meet at (optional, public places only)</span>
        <select value={spotId ?? ""} onChange={(e) => setSpotId(e.target.value ? Number(e.target.value) : null)} className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-base" data-testid="select-meetup-spot">
          <option value="">Decide later</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name}{s.avgRating != null ? ` · ${s.avgRating.toFixed(1)}★` : ""}</option>)}
        </select>
      </label>
      )}
      {crew.length > 0 && (
        <div data-testid="meetup-audience">
          <p className="text-xs font-medium text-muted-foreground">Who sees it</p>
          {!trip && <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setPickAll(true)} className={chip(pickAll)} data-testid="chip-meetup-all">All my crew ({crew.length})</button>
            <button type="button" onClick={() => setPickAll(false)} className={chip(!pickAll)} data-testid="chip-meetup-pick">Pick crew</button>
          </div>}
          {!pickAll && (
            <div className="mt-2 rounded-xl border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
                <span className="text-muted-foreground" data-testid="text-meetup-picked">{picked.length} of {crew.length} picked</span>
                <button type="button" onClick={() => setPicked(picked.length === crew.length ? [] : crew.map((c) => c.id))} className="font-semibold text-foreground underline underline-offset-2" data-testid="button-meetup-selectall">{picked.length === crew.length ? "Clear" : "Select all"}</button>
              </div>
              <ul className="max-h-60 divide-y divide-border overflow-y-auto">
                {crew.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} className="h-5 w-5 accent-[hsl(var(--primary))]" data-testid={`check-meetup-viewer-${c.id}`} />
                      <CrewAvatar aircraft={c.aircraft} className="h-7 w-7 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm">{c.displayName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.crewRole}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {d.requireCheckin && !d.verifiedHere && !later && <p className="text-xs text-destructive">Check in at {icao} first, so crews know you're really here.</p>}
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />Your crew sees {me?.displayName || "your display name"}, your role and aircraft icon. No location beyond the airport is shared.</p>
      <button type="button" onClick={() => post.mutate()} disabled={post.isPending || blocked} className="h-11 w-full rounded-full taxi-sign text-sm font-semibold hover-elevate disabled:opacity-60" data-testid="button-meetup-post">
        {post.isPending ? "Posting…" : trip && !picked.length ? "Pick who sees it" : pickAll ? `Post to my crew at ${icao}` : `Post to ${picked.length || "picked"} crew at ${icao}`}
      </button>
    </section>
  );
}

function Posted({ mine }: { mine: Meetup }) {
  const { toast } = useToast();
  const trip = useTrip();
  const [editing, setEditing] = useState(false);
  const cur = mine.startsAt > Date.now() ? { date: localDate(mine.tz, mine.startsAt), time: new Intl.DateTimeFormat("en-GB", { timeZone: mine.tz || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(mine.startsAt) } : nowSlot(mine.tz);
  const [nd, setNd] = useState(cur.date), [nt, setNt] = useState(cur.time);
  const move = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/preview/meetups/${mine.id}`, { startDate: nd, startTime: nt })).json(),
    onSuccess: () => { toast({ title: "Plan updated", description: "Crew see the new date and time." }); setEditing(false); void refresh(); },
    onError: (e) => toast({ title: "Couldn't change it", description: errMsg(e), variant: "destructive" }),
  });
  const end = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/preview/meetups/${mine.id}`)).json(),
    onSuccess: () => { toast({ title: "Ended", description: "You're no longer listed there." }); void refresh(); },
  });
  const who = !mine.viewers ? "All my crew" : mine.viewers.length <= 3 ? mine.viewers.map((p) => p.name).join(", ") : `${mine.viewers.slice(0, 2).map((p) => p.name).join(", ")} + ${mine.viewers.length - 2} more`;
  return (
    <section className="rounded-2xl border border-primary/60 bg-card p-4" data-testid={`card-meetup-mine-${mine.id}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{upcoming(mine) ? "Coming up at" : "You're posted at"} <span className="font-code">{mine.icao}</span></p>
        <When m={mine} />
      </div>
      {mine.note && <p className="mt-1.5 text-sm" data-testid="text-meetup-mynote">{mine.note}</p>}
      {mine.spot ? <PlaceLine s={mine.spot} /> : mine.place ? <PlaceText t={mine.place} /> : null}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`text-meetup-viewers-${mine.id}`}><Eye className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Seen by {who}</span></p>
      <div className="mt-3">
        <p className="text-xs font-medium text-muted-foreground">Who's in</p>
        {mine.attendees.length ? (
          <ul className="mt-1.5 space-y-1.5" data-testid="list-meetup-attendees">{mine.attendees.map((p) => <li key={p.id}><Person p={p} /></li>)}</ul>
        ) : <p className="mt-1 text-sm text-muted-foreground">No one yet. Crew who tap I'm in show up here.</p>}
      </div>
      {trip && editing && (
        <div className="mt-3 space-y-2 rounded-xl border border-border p-3" data-testid={`edit-meetup-when-${mine.id}`}>
          <p className="text-xs font-medium text-muted-foreground">New date and time (local at {mine.icao})</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={nd} min={localDate(mine.tz)} max={localDate(mine.tz, Date.now() + MEETUP_RULES.maxDaysAhead * 86400_000)} onChange={(e) => setNd(e.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-2 text-base" data-testid={`input-meetup-edit-date-${mine.id}`} />
            <input type="time" value={nt} onChange={(e) => setNt(e.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-2 text-base" data-testid={`input-meetup-edit-time-${mine.id}`} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => move.mutate()} disabled={move.isPending || !nd || !nt} className="h-9 flex-1 rounded-full taxi-sign text-xs font-semibold disabled:opacity-50" data-testid={`button-meetup-edit-save-${mine.id}`}>{move.isPending ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-full border border-border px-4 text-xs font-semibold">Cancel</button>
          </div>
        </div>
      )}
      {trip && !editing && (
        <button type="button" onClick={() => { setNd(cur.date); setNt(cur.time); setEditing(true); }} className="mt-3 mr-2 inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid={`button-meetup-edit-${mine.id}`}>
          <CalendarClock className="h-3.5 w-3.5" />{mine.startsAt > Date.now() + SOON ? "Change date or time" : "Add a date"}
        </button>
      )}
      <ThreadButton meetupId={mine.id} className="mt-3 mr-2 inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate disabled:opacity-50" />
      <button type="button" onClick={() => end.mutate()} disabled={end.isPending} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid={`button-meetup-end-${mine.id}`}><LogOut className="h-3.5 w-3.5" />{upcoming(mine) ? "Cancel it" : "End it"}</button>
    </section>
  );
}

/** Plans from your crew at this airport. */
function CrewHere({ d }: { d: MeetupResp }) {
  if (!d.icao || d.crewCount === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your crew at {d.icao}</h2>
      {!d.others?.length ? <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-meetup-noothers">Nobody in your crew has posted plans here. This page checks again every minute.</p>
        : <ul className="space-y-2" data-testid="list-meetup-others">{d.others.map((m) => <li key={m.id}><Other m={m} /></li>)}</ul>}
    </section>
  );
}

function Other({ m, showIcao }: { m: Meetup; showIcao?: boolean }) {
  const { toast } = useToast();
  const join = useMutation({
    mutationFn: async () => (await apiRequest(m.joined ? "DELETE" : "POST", `/api/preview/meetups/${m.id}/join`)).json(),
    onSuccess: () => void refresh(),
    onError: (e) => toast({ title: "Couldn't update", description: errMsg(e), variant: "destructive" }),
  });
  const report = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/preview/meetups/${m.id}/report`, { reason: "member report" })).json(),
    onSuccess: () => toast({ title: "Reported", description: "Thanks. An admin will take a look." }),
  });
  return (
    <article className="rounded-2xl border border-card-border bg-card p-4" data-testid={`card-meetup-${m.id}`}>
      <div className="flex items-start justify-between gap-3">
        <Person p={m.host} />
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{showIcao && <span className="mr-1 rounded bg-muted px-1.5 font-code font-bold text-foreground">{m.icao}</span>}{!upcoming(m) && <When m={m} />}</span>
      </div>
      {upcoming(m) && <p className="mt-2"><When m={m} /></p>}
      {m.note && <p className="mt-2 text-sm">{m.note}</p>}
      {m.spot ? <PlaceLine s={m.spot} /> : m.place ? <PlaceText t={m.place} /> : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => join.mutate()} disabled={join.isPending}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold hover-elevate", m.joined ? "border border-primary bg-primary/15" : "taxi-sign")} data-testid={`button-meetup-join-${m.id}`}>
          {m.joined ? <><UserCheck className="h-3.5 w-3.5" />You're in</> : <><UserPlus className="h-3.5 w-3.5" />I'm in</>}
        </button>
        <ThreadButton meetupId={m.id} />
        <span className="text-xs text-muted-foreground">{m.joins ? `${m.joins} in` : ""}</span>
        <button type="button" onClick={() => { if (window.confirm("Report these plans to the Wheelsdown team?")) report.mutate(); }} className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover-elevate" data-testid={`button-meetup-report-${m.id}`}><Flag className="h-3.5 w-3.5" />Report</button>
      </div>
    </article>
  );
}

function Person({ p }: { p: MeetupPerson }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <CrewAvatar aircraft={p.aircraft} className="h-9 w-9 shrink-0" />
      <span className="min-w-0">
        <Link href={`/crew/${p.id}`} className="block truncate text-sm font-semibold hover:underline">{p.name}</Link>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{p.crewRole}{p.verified && <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400" title="Checked in at this airport today"><BadgeCheck className="h-3.5 w-3.5" />Checked in</span>}</span>
      </span>
    </span>
  );
}

function PlaceLine({ s }: { s: { id: number; name: string } }) {
  return <Link href={`/spot/${s.id}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-foreground underline underline-offset-2" data-testid={`link-meetup-spot-${s.id}`}><MapPin className="h-3.5 w-3.5" />{s.name}</Link>;
}

function PlaceText({ t }: { t: string }) {
  return <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold" data-testid="text-meetup-place"><MapPin className="h-3.5 w-3.5" />{t}</p>;
}
