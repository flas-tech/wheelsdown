// Crew Up (was "Crew meetup"): layover plans at the airport level, seen only by people in each other's My Crew.
// No strangers: you see a plan only when the host is in your crew. Posts end by themselves.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BadgeCheck, CalendarClock, Clock, Eye, Flag, Loader2, LogOut, MapPin, Plus, ShieldCheck, UserCheck, UserPlus, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CrewAvatar } from "@/lib/aircraft";
import { PreviewBadge, PreviewGate, errMsg, left } from "@/lib/preview";
import { InviteCrewCard, useMyCrew } from "@/lib/mycrew";
import { markCrewUpSeen } from "@/lib/tabDots";
import { crewUpHref, crewUpPrefill, fmtArrive, type TripResp, type TripStop } from "@/lib/tripNav";
import { useTrip } from "@/lib/experience";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { findTailNumbers } from "@shared/tailNumber";
import { MEETUP_PRIVACY, MEETUP_RULES, meetupNoteProblem, type Meetup, type MeetupPerson, type MeetupResp } from "@shared/layover";
import type { SpotWithStats } from "@shared/schema";

export default function MeetupPage() { return <PreviewGate><MeetupBoard /></PreviewGate>; }

const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/preview/") });

const SOON = 5 * 60_000;
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
  const full = (data?.mine.length || 0) >= MEETUP_RULES.maxPlans;

  return (
    <div className="space-y-4" data-testid="page-meetup">
      <header className="space-y-1">
        <PreviewBadge />
        <h1 className="text-xl font-semibold">Crew Up</h1>
        <p className="text-sm text-muted-foreground">Make layover plans with your crew, tonight or for a trip coming up. Only people in your <Link href="/mycrew" className="font-medium text-foreground underline underline-offset-2">My Crew</Link> see them, or just the ones you pick. Airport level only, and they end by themselves.</p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); go(typed); }} className="flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={4} placeholder={data?.icao ? `Not at ${data.icao}? Type the airport` : "Which airport? e.g. TEB"}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 font-code text-base uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70" data-testid="input-meetup-airport" aria-label="Airport" />
        <button type="submit" className="h-11 rounded-xl taxi-sign px-4 text-sm font-semibold hover-elevate disabled:opacity-60" disabled={typed.trim().length < 3} data-testid="button-meetup-go">Go</button>
      </form>

      {fromBriefs.length > 0 && (
        <section className="space-y-1.5" data-testid="section-meetup-briefs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From your briefs</h2>
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
          {data.mine.length > 0 && (
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
              <CrewHere d={data} />
            </>}
          {data.crewElsewhere.length > 0 && (
            <section className="space-y-2" data-testid="section-crew-elsewhere">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your crew at other airports</h2>
              <ul className="space-y-2">{data.crewElsewhere.map((m) => <li key={m.id}><Other m={m} showIcao /></li>)}</ul>
            </section>
          )}
          <InviteCrewCard compact crewUp />
        </>}
    </div>
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
  const [date, setDate] = useState(() => preDate || (localHour >= 18 ? localDate(d.tz, Date.now() + 86400_000) : today));
  const [time, setTime] = useState(pre?.time && preDate ? pre.time : "19:00");
  const [pickAll, setPickAll] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const [note, setNote] = useState("");
  const [hours, setHours] = useState<number>(() => ((MEETUP_RULES.hours as readonly number[]).includes(pre?.hours || 0) ? pre!.hours! : MEETUP_RULES.defaultHours));
  const [spotId, setSpotId] = useState<number | null>(null);
  const { data: places } = useQuery<{ spots: SpotWithStats[] }>({ queryKey: ["/api/search", icao], queryFn: async () => (await apiRequest("GET", `/api/search?route=${icao}`)).json(), staleTime: 300_000 });
  const options = (places?.spots || []).filter((s) => s.icao === icao && (s.category === "eat" || s.category === "do" || s.category === "fbo")).sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).slice(0, 25);
  const tails = findTailNumbers(note).length > 0;
  const priv = meetupNoteProblem(note);
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/preview/meetups", { icao, note: note.trim(), hours, spotId, ...(later ? { startDate: date, startTime: time } : {}), viewers: pickAll ? null : picked })).json(),
    onSuccess: () => {
      toast({ title: pickAll ? `Posted to your crew at ${icao}` : `Shared with ${picked.length} of your crew at ${icao}`, description: later ? `Starts ${date} at ${time} local, for ${hours} hours.` : `Ends in ${hours} hours, or when you end it.` });
      setNote(""); setLater(false); onPosted?.(); void refresh();
    },
    onError: (e) => toast({ title: "Couldn't post", description: errMsg(e), variant: "destructive" }),
  });
  const blocked = tails || !!priv || note.length > MEETUP_RULES.noteMax || (d.requireCheckin && !d.verifiedHere && !later) || (!pickAll && !picked.length) || (later && (!date || !time));
  const maxDate = localDate(d.tz, Date.now() + MEETUP_RULES.maxDaysAhead * 86400_000);
  const chip = (on: boolean) => cn("h-9 rounded-full border px-3.5 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover-elevate");
  return (
    <section className="space-y-4 rounded-2xl border border-card-border bg-card p-4" data-testid="card-meetup-compose">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><Users className="h-5 w-5" /></span>
        <div>
          <h2 className="text-base font-semibold">Plans at <span className="font-code">{icao}</span></h2>
          <p className="text-xs text-muted-foreground">Tonight or a trip coming up. Your crew sees them, or only the people you pick. Nobody outside your crew does.</p>
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
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Meet at (optional, public places only)</span>
        <select value={spotId ?? ""} onChange={(e) => setSpotId(e.target.value ? Number(e.target.value) : null)} className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-base" data-testid="select-meetup-spot">
          <option value="">Decide later</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name}{s.avgRating != null ? ` · ${s.avgRating.toFixed(1)}★` : ""}</option>)}
        </select>
      </label>
      {crew.length > 0 && (
        <div data-testid="meetup-audience">
          <p className="text-xs font-medium text-muted-foreground">Who sees it</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setPickAll(true)} className={chip(pickAll)} data-testid="chip-meetup-all">All my crew ({crew.length})</button>
            <button type="button" onClick={() => setPickAll(false)} className={chip(!pickAll)} data-testid="chip-meetup-pick">Pick crew</button>
          </div>
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
        {post.isPending ? "Posting…" : pickAll ? `Post to my crew at ${icao}` : `Post to ${picked.length || "picked"} crew at ${icao}`}
      </button>
    </section>
  );
}

function Posted({ mine }: { mine: Meetup }) {
  const { toast } = useToast();
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
      {mine.spot && <PlaceLine s={mine.spot} />}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`text-meetup-viewers-${mine.id}`}><Eye className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Seen by {who}</span></p>
      <div className="mt-3">
        <p className="text-xs font-medium text-muted-foreground">Who's in</p>
        {mine.attendees.length ? (
          <ul className="mt-1.5 space-y-1.5" data-testid="list-meetup-attendees">{mine.attendees.map((p) => <li key={p.id}><Person p={p} /></li>)}</ul>
        ) : <p className="mt-1 text-sm text-muted-foreground">No one yet. Crew who tap I'm in show up here.</p>}
      </div>
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
      {m.spot && <PlaceLine s={m.spot} />}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => join.mutate()} disabled={join.isPending}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold hover-elevate", m.joined ? "border border-primary bg-primary/15" : "taxi-sign")} data-testid={`button-meetup-join-${m.id}`}>
          {m.joined ? <><UserCheck className="h-3.5 w-3.5" />You're in</> : <><UserPlus className="h-3.5 w-3.5" />I'm in</>}
        </button>
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
