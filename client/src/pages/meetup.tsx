// Crew Up (was "Crew meetup"): layover plans at the airport level, seen only by people in each other's My Crew.
// No strangers: you see a plan only when the host is in your crew. Posts end by themselves.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BadgeCheck, Clock, Flag, Loader2, LogOut, MapPin, ShieldCheck, UserCheck, UserPlus, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CrewAvatar } from "@/lib/aircraft";
import { PreviewBadge, PreviewGate, errMsg, left } from "@/lib/preview";
import { InviteCrewCard } from "@/lib/mycrew";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { findTailNumbers } from "@shared/tailNumber";
import { MEETUP_PRIVACY, MEETUP_RULES, meetupNoteProblem, type Meetup, type MeetupPerson, type MeetupResp } from "@shared/layover";
import type { SpotWithStats } from "@shared/schema";

export default function MeetupPage() { return <PreviewGate><MeetupBoard /></PreviewGate>; }

const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/preview/") });

function MeetupBoard() {
  const [code, setCode] = useState<string>(() => new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1)).get("icao")?.toUpperCase() || "");
  const [typed, setTyped] = useState("");
  const { data, isLoading, error } = useQuery<MeetupResp>({
    queryKey: ["/api/preview/meetups", code], queryFn: async () => (await apiRequest("GET", `/api/preview/meetups${code ? `?icao=${encodeURIComponent(code)}` : ""}`)).json(), staleTime: 20_000, refetchInterval: 60_000, retry: false,
  });
  const go = (c: string) => { const v = c.trim().toUpperCase(); if (v.length >= 3) { setCode(v); setTyped(""); } };

  return (
    <div className="space-y-4" data-testid="page-meetup">
      <header className="space-y-1">
        <PreviewBadge />
        <h1 className="text-xl font-semibold">Crew Up</h1>
        <p className="text-sm text-muted-foreground">Make layover plans with your crew. Only people in your <Link href="/mycrew" className="font-medium text-foreground underline underline-offset-2">My Crew</Link> see them. Airport level only, and they end by themselves.</p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); go(typed); }} className="flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={4} placeholder={data?.icao ? `Not at ${data.icao}? Type the airport` : "Which airport? e.g. TEB"}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 font-code text-base uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70" data-testid="input-meetup-airport" aria-label="Airport" />
        <button type="submit" className="h-11 rounded-xl taxi-sign px-4 text-sm font-semibold hover-elevate disabled:opacity-60" disabled={typed.trim().length < 3} data-testid="button-meetup-go">Go</button>
      </form>

      {isLoading ? <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : error ? <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-meetup-error">{errMsg(error)}</p>
        : !data ? null : <>
          {data.crewCount === 0 && <p className="rounded-2xl border border-primary/50 bg-primary/5 p-4 text-sm" data-testid="text-meetup-nocrew"><span className="font-semibold">Add your crew first.</span> <span className="text-muted-foreground">Crew Up plans are only seen by people in your crew, so nobody sees yours until you've added someone and they've accepted.</span></p>}
          {!data.icao ? <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-meetup-empty">Type the airport you're at to make plans with your crew there.</p>
            : data.mine ? <Posted d={data} /> : <><Compose d={data} /><CrewHere d={data} /></>}
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

function Compose({ d }: { d: MeetupResp }) {
  const icao = d.icao!;
  const { me } = useAuth();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [hours, setHours] = useState<number>(MEETUP_RULES.defaultHours);
  const [spotId, setSpotId] = useState<number | null>(null);
  const { data: places } = useQuery<{ spots: SpotWithStats[] }>({ queryKey: ["/api/search", icao], queryFn: async () => (await apiRequest("GET", `/api/search?route=${icao}`)).json(), staleTime: 300_000 });
  const options = (places?.spots || []).filter((s) => s.icao === icao && (s.category === "eat" || s.category === "do" || s.category === "fbo")).sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).slice(0, 25);
  const tails = findTailNumbers(note).length > 0;
  const priv = meetupNoteProblem(note);
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/preview/meetups", { icao, note: note.trim(), hours, spotId })).json(),
    onSuccess: () => { toast({ title: `Posted to your crew at ${icao}`, description: `Ends in ${hours} hours, or when you end it.` }); void refresh(); },
    onError: (e) => toast({ title: "Couldn't post", description: errMsg(e), variant: "destructive" }),
  });
  const blocked = tails || !!priv || note.length > MEETUP_RULES.noteMax || (d.requireCheckin && !d.verifiedHere);
  return (
    <section className="space-y-4 rounded-2xl border border-card-border bg-card p-4" data-testid="card-meetup-compose">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><Users className="h-5 w-5" /></span>
        <div>
          <h2 className="text-base font-semibold">At <span className="font-code">{icao}</span> tonight?</h2>
          <p className="text-xs text-muted-foreground">Post your plans and your crew sees them. Nobody outside your crew does.</p>
        </div>
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
            <button key={h} type="button" onClick={() => setHours(h)} className={cn("h-9 rounded-full border px-3.5 text-sm font-medium", hours === h ? "border-primary bg-primary text-primary-foreground" : "border-border hover-elevate")} data-testid={`chip-meetup-hours-${h}`}>{h} h</button>
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
      {d.requireCheckin && !d.verifiedHere && <p className="text-xs text-destructive">Check in at {icao} first, so crews know you're really here.</p>}
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />Your crew sees {me?.displayName || "your display name"}, your role and aircraft icon. No location beyond the airport is shared.</p>
      <button type="button" onClick={() => post.mutate()} disabled={post.isPending || blocked} className="h-11 w-full rounded-full taxi-sign text-sm font-semibold hover-elevate disabled:opacity-60" data-testid="button-meetup-post">
        {post.isPending ? "Posting…" : `Post to my crew at ${icao}`}
      </button>
    </section>
  );
}

function Posted({ d }: { d: MeetupResp }) {
  const { toast } = useToast();
  const mine = d.mine!;
  const end = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/preview/meetups/${mine.id}`)).json(),
    onSuccess: () => { toast({ title: "Ended", description: "You're no longer listed here." }); void refresh(); },
  });
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-primary/60 bg-card p-4" data-testid="card-meetup-mine">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">You're posted at <span className="font-code">{mine.icao}</span></p>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />{left(mine.expiresAt)}</span>
        </div>
        {mine.note && <p className="mt-1.5 text-sm" data-testid="text-meetup-mynote">{mine.note}</p>}
        {mine.spot && <PlaceLine s={mine.spot} />}
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">Who's in</p>
          {mine.attendees.length ? (
            <ul className="mt-1.5 space-y-1.5" data-testid="list-meetup-attendees">{mine.attendees.map((p) => <li key={p.id}><Person p={p} /></li>)}</ul>
          ) : <p className="mt-1 text-sm text-muted-foreground">No one yet. Crew who tap I'm in show up here.</p>}
        </div>
        <button type="button" onClick={() => end.mutate()} disabled={end.isPending} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid="button-meetup-end"><LogOut className="h-3.5 w-3.5" />End it</button>
      </section>

      <CrewHere d={d} />
    </div>
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
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">{showIcao && <span className="mr-1 rounded bg-muted px-1.5 font-code font-bold text-foreground">{m.icao}</span>}<Clock className="h-3.5 w-3.5" />{left(m.expiresAt)}</span>
      </div>
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
