import { noteVisit } from "@/lib/visits";
import { focusLabel, isFocus, focusCategory } from "@shared/focus";
import { ACTIVITIES } from "@shared/activities";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { BadgeCheck, Building2, Check, ExternalLink, Hotel, Loader2, MapPin, Plus, Sparkles, Users } from "lucide-react";
import type { SpotWithStats } from "@shared/schema";
import { MEAL_LABEL } from "@shared/briefing";
import { costRange, costText } from "@shared/cost";
import { PROGRAMS, programOf, programShort, type ProgramId } from "@shared/loyalty";
import { CUISINES, cuisineLabel } from "@shared/cuisine";
import { useToast } from "@/hooks/use-toast";
import { CAT_META, fmtMinutes } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { DirectionsButton } from "@/lib/directions";
import type { AiPick } from "@/lib/briefPdf";

/** "AI pick" (suggested where no crew has listed anything yet). Crew listings carry no tag: crew-added is the default,
 *  so it goes without saying (user, Oct 26). */
export function PickTag({ ai, className }: { ai: boolean; className?: string }) {
  return ai ? (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300", className)} title="Suggested by AI because no crew has listed a place here yet" data-testid="tag-ai-pick"><Sparkles className="h-3 w-3" />AI pick</span>
  ) : null;
}

/** A listing added by the FBO at the airport through the FBO portal. Ratings on it still come only from crews. */
export const isFboAdded = (s: { source?: string | null; id?: number }) => (s as any).source === "fbo";
export function FboPickTag({ by, className }: { by?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300", className)}
      title={`Added by ${by || "the FBO"} at this airport. Ratings come from crews.`} data-testid="tag-fbo-pick">
      <Building2 className="h-3 w-3" />FBO pick
    </span>
  );
}

/** FBOs at the airport stand behind this listing. recommended = at least one chose "List and recommend" (the better
 *  options); otherwise they only listed it ("List only": close and decent). */
export function FboRecTag({ names, n, recommended = true, className }: { names?: string[]; n?: number; recommended?: boolean; className?: string }) {
  const who = names?.length ? names.join(", ") + ((n ?? 0) > names.length ? ` and ${(n ?? 0) - names.length} more` : "") : "the FBO";
  return recommended ? (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-sky-500/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300", className)}
      title={`Recommended by ${who}: one of the better options near the field`} data-testid="tag-fbo-rec">
      <BadgeCheck className="h-3 w-3" />FBO recommended
    </span>
  ) : (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground", className)}
      title={`Listed by ${who}: close by and decent`} data-testid="tag-fbo-listed">
      <Building2 className="h-3 w-3" />FBO listed
    </span>
  );
}
/** "recommended" / "listed" when FBOs at the airport have this place on their list, else null. */
export const fboLevel = (s: { fboRecs?: { n: number; rec?: number } | null }) => (s.fboRecs ? ((s.fboRecs.rec ?? s.fboRecs.n) > 0 ? "recommended" : "listed") : null);
/** The FBO tag for a search card or spot page, from the fboRecs summary. */
export const fboRecTagFor = (r?: { n: number; names: string[]; rec?: number } | null) => (r ? <FboRecTag names={r.names} n={r.n} recommended={(r.rec ?? r.n) > 0} /> : null);

/** A listing added from an AI pick kept in a saved briefing. Says so until crews rate it. */
export function AiAddedTag({ rated, className }: { rated?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300", className)}
      title="Added by AI from a crew briefing. Crews haven't checked it yet." data-testid="tag-ai-added">
      <Sparkles className="h-3 w-3" />{rated ? "AI added" : "AI added · no crew ratings yet"}
    </span>
  );
}

/** Rewards-program chip on hotels (Hilton, Marriott…), read from the hotel's name. */
export function ProgramChip({ spot }: { spot: Pick<SpotWithStats, "category" | "name" | "description" | "website" | "id"> }) {
  const mine = useMyPrograms();
  const p = programOf(spot);
  if (!p) return null;
  const yours = mine.includes(p);
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4", yours ? "bg-sky-600 text-white" : "bg-sky-500/10 text-sky-800 dark:text-sky-300")} title={yours ? "One of your hotel programs" : undefined} data-testid={`text-program-${spot.id}`}>{programShort(p)}{yours ? " · yours" : ""}</span>;
}

export function AiCard({ spot }: { spot: AiPick }) {
  const M = CAT_META[spot.category as keyof typeof CAT_META];
  // OpenStreetMap places come with exact coordinates, so Maps opens on the right spot even without an address
  const maps = `https://maps.apple.com/?q=${encodeURIComponent(spot.name + (spot.address ? " " + spot.address : ""))}${spot.lat != null && spot.lng != null ? `&ll=${spot.lat},${spot.lng}` : ""}`;
  const out = spot.website || maps;
  const went = () => noteVisit({ id: spot.id, name: spot.name, icao: spot.icao, href: aiAddHref(spot) });
  return (
    <article className="rounded-2xl border border-dashed border-violet-400/60 bg-card p-4" data-testid={`card-ai-${-spot.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <PickTag ai />
            {spot.ai.draft && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Found on OpenStreetMap. AI is still checking it." data-testid={`badge-ai-draft-${-spot.id}`}><Loader2 className="h-2.5 w-2.5 animate-spin" />Checking</span>}
            {spot.ai.meal && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">{MEAL_LABEL[spot.ai.meal]}</span>}
            <ProgramChip spot={spot} />
          </div>
          <a href={out} target="_blank" rel="noopener noreferrer" className="mt-1.5 block text-base font-semibold leading-snug hover:underline underline-offset-2">{spot.name}</a>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><M.icon className="h-3 w-3" />{M.label}</span>
            {spot.milesFromField ? ` · ${spot.milesFromField} mi` : ""}{spot.category === "do" && spot.minutesNeeded ? ` · ${fmtMinutes(spot.minutesNeeded)}` : ""}
          </p>
        </div>
        {spot.cost != null && <span className="shrink-0 text-right"><span className="block font-code text-sm font-bold text-primary">{costText(spot)}</span>{spot.cost > 0 && <span className="block text-[10px] text-muted-foreground whitespace-nowrap">{costRange(spot.category, spot.cost)}</span>}</span>}
      </div>
      {spot.description && <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{spot.description}</p>}
      {spot.address && <a href={maps} onClick={went} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><MapPin className="h-3 w-3" />{spot.address}</a>}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-3"><DirectionsButton place={spot} visitHref={aiAddHref(spot)} testId={`button-ai-directions-${-spot.id}`} />
        {spot.website && <a href={out} onClick={went} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" />Website</a>}</span>
        <Link href={aiAddHref(spot)} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`link-ai-add-${-spot.id}`}><Plus className="h-3.5 w-3.5" />Been here? Add it for crews</Link>
      </div>
      <FirstRateNote />
    </article>
  );
}

/** AI picks the user has already asked for at these fields (read from the query cache, never fetched here),
 *  so the search map can pin them next to crew listings (Joe, Oct 26). */
export function useCachedAiPicks(icaos: string[], category: string, program?: ProgramId | null): AiPick[] {
  const [tick, setTick] = useState(0);
  useEffect(() => queryClient.getQueryCache().subscribe((e) => { if (String(e.query.queryKey[0]).startsWith("/api/ai-picks?")) setTick((t) => t + 1); }), []);
  const want = icaos.join(",");
  return useMemo(() => {
    const set = new Set(icaos), seen = new Set<number>(), out: AiPick[] = [];
    for (const q of queryClient.getQueryCache().findAll({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/ai-picks?") })) {
      const u = new URLSearchParams(String(q.queryKey[0]).split("?")[1] || "");
      if (!set.has(u.get("icao") || "") || u.get("cat") !== category) continue;
      const d = q.state.data as { picks?: AiPick[] } | undefined;
      for (const p of d?.picks || []) if (!seen.has(p.id) && p.lat != null && p.lng != null && (!program || programOf(p) === program)) { seen.add(p.id); out.push(p); }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, want, category, program]);
}

/** Add-a-spot link prefilled from an AI pick; the id lets the server credit the first-to-rate bonus. */
export const aiAddHref = (spot: AiPick) => `/add/${spot.icao}?name=${encodeURIComponent(spot.name)}&cat=${spot.category}&ai=${-spot.id}${spot.address ? `&addr=${encodeURIComponent(spot.address)}` : ""}`;
export function FirstRateNote({ className }: { className?: string }) {
  return <p className={cn("mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-400", className)} data-testid="text-first-rate">+10 points if you're the first crew member to add and rate it.</p>;
}

/** Hotel rewards programs the member collects (Settings). Their hotels come first in AI picks, briefs and search. */
export function useMyPrograms(): ProgramId[] {
  const { me } = useAuth();
  const { data } = useQuery<{ programs: ProgramId[] }>({ queryKey: ["/api/me/programs"], enabled: !!me, staleTime: 5 * 60_000 });
  return (me && data?.programs) || [];
}
export function ProgramsCard() {
  const { me } = useAuth();
  const mine = useMyPrograms();
  const m = useMutation({
    mutationFn: async (next: ProgramId[]) => (await apiRequest("PUT", "/api/me/programs", { programs: next })).json(),
    onSuccess: (r) => { queryClient.setQueryData(["/api/me/programs"], r); queryClient.invalidateQueries({ queryKey: ["/api/briefings"] }); },
  });
  if (!me) return null;
  const toggle = (id: ProgramId) => m.mutate(mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]);
  return (
    <section id="pf-programs" className="rounded-2xl border border-card-border bg-card p-4 space-y-3 scroll-mt-24" data-testid="section-programs">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Hotel className="h-4 w-4 text-sky-600" />My hotel programs</h2>
        <p className="text-xs text-muted-foreground">The points you chase. Hotels from these come first in briefs, AI picks and search.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PROGRAMS.map((p) => {
          const on = mine.includes(p.id);
          return (
            <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on} disabled={m.isPending} data-testid={`button-program-${p.id}`}
              className={cn("inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold", on ? "border-sky-600 bg-sky-600 text-white" : "border-input text-muted-foreground hover:text-foreground")}>
              {on && <Check className="h-3.5 w-3.5" />}{p.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** "Find more places": any food, a food type, or Surprise me (what the area is known for). */
/** Ask AI for more places. `fixed` = the choice was already made (briefing More places), so only the button shows. */
export function FindMore({ icao, pending, onDone, initial = "", testId = "find-more", compact, fixed }: { icao: string; pending?: boolean; onDone?: () => void; initial?: string; testId?: string; compact?: boolean; fixed?: string }) {
  const { me } = useAuth();
  const { toast } = useToast();
  const [chosen, setFocus] = useState(initial);
  useEffect(() => setFocus(initial), [initial]);
  const focus = fixed ?? chosen;
  const m = useMutation({
    mutationFn: async () => (await (await apiRequest("POST", "/api/ai-picks/more", { icao, focus })).json()) as { status: string },
    onSuccess: (r) => {
      if (r.status === "full") toast({ title: `That's plenty for ${icao}`, description: "AI has already found as many places as we keep for one airport." });
      else if (r.status === "busy") toast({ title: "AI is at today's limit", description: "Try again tomorrow, or add a place you know." });
      else if (r.status === "pending") toast({ title: focus === "local" ? `Finding what ${icao} is known for` : focus ? `Finding ${focusLabel(focus).toLowerCase()} near ${icao}` : `Finding more places near ${icao}`, description: "Usually under a minute." });
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/ai-picks") });
      onDone?.();
    },
    onError: (e: Error) => toast({ title: "Couldn't ask AI", description: e.message.replace(/^\d+: /, ""), variant: "destructive" }),
  });
  if (!me) return <Link href="/me" className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">Sign in to ask AI for more places</Link>;
  const busy = pending || m.isPending;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact && "w-full")} data-testid={testId}>
      {fixed === undefined && <select value={focus} onChange={(e) => setFocus(e.target.value)} disabled={busy} aria-label="What kind of places" data-testid={`${testId}-focus`}
        className="h-8 min-w-0 flex-1 rounded-full border border-input bg-background px-3 text-[11px] font-semibold sm:flex-none">
        <option value="">Any food and things to do</option>
        <option value="local">Surprise me: what {icao} is known for</option>
        <option value="eat">Any food</option>
        <optgroup label="Food type">{CUISINES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
        <option value="do">Any things to do</option>
        <optgroup label="Things to do">{ACTIVITIES.map((a) => <option key={a.id} value={`act:${a.id}`}>{a.label}</option>)}</optgroup>
        <option value="stay">Hotels</option>
      </select>}
      <button type="button" onClick={() => m.mutate()} disabled={busy} data-testid={`${testId}-go`}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-violet-600 px-3 text-[11px] font-semibold text-white hover-elevate disabled:opacity-60">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{focus === "local" ? "Surprise me" : fixed ? `Ask AI for more ${focusLabel(fixed).toLowerCase()}` : "Find more places"}
      </button>
    </div>
  );
}

export type AiPref = "crew" | "ai";
/** The member's AI setting: "crew" (default) = AI picks only when asked; "ai" = fill gaps automatically. */
export function useAiPref() {
  const { me } = useAuth();
  const { data } = useQuery<{ pref: AiPref }>({ queryKey: ["/api/me/ai-pref"], enabled: !!me, staleTime: 5 * 60_000 });
  return (me && data?.pref) || "crew";
}

/** Settings: Prefer crew or Prefer AI. */
export function AiPrefCard() {
  const { me } = useAuth();
  const pref = useAiPref();
  const { data: cfg } = useQuery<{ ai?: boolean }>({ queryKey: ["/api/config"] });
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (/[?&]s=ai\b/.test(window.location.hash + window.location.search)) setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300); }, []);
  const m = useMutation({
    mutationFn: async (next: AiPref) => (await apiRequest("PUT", "/api/me/ai-pref", { pref: next })).json(),
    onSuccess: (r) => { queryClient.setQueryData(["/api/me/ai-pref"], r); queryClient.invalidateQueries({ queryKey: ["/api/briefings"] }); },
  });
  if (!me || cfg?.ai === false) return null;
  const opt = (id: AiPref, title: string, sub: string, Icon: typeof Users) => (
    <button type="button" onClick={() => id !== pref && m.mutate(id)} aria-pressed={pref === id} disabled={m.isPending} data-testid={`button-ai-pref-${id}`}
      className={cn("flex-1 rounded-xl border p-3 text-left", pref === id ? "border-primary bg-primary/10" : "border-input")}>
      <span className="flex items-center gap-1.5 text-sm font-semibold"><Icon className={cn("h-4 w-4", id === "ai" ? "text-violet-600" : "text-emerald-600")} />{title}</span>
      <span className="mt-0.5 block text-[11px] text-muted-foreground">{sub}</span>
    </button>
  );
  return (
    <section ref={box} id="pf-ai" className="rounded-2xl border border-card-border bg-card p-4 space-y-3 scroll-mt-24" data-testid="section-ai-pref">
      <div>
        <h2 className="text-sm font-semibold">When crews haven't listed a place</h2>
        <p className="text-xs text-muted-foreground">For briefings and search. Crew picks always come first.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {opt("crew", "Prefer crew", "Show only crew picks. Tap Pick with AI when you want suggestions.", Users)}
        {opt("ai", "Prefer AI", "Fill gaps automatically with AI picks, tagged AI pick.", Sparkles)}
      </div>
    </section>
  );
}

/** Search fallback: when crews have nothing at an airport in this category, offer (or, with Prefer AI, show) AI picks. */
/** Under crew results: one button that shows AI picks of the same kind alongside them (same panel as an empty search). */
export function MoreAiPlaces({ icao, category, program, food }: { icao: string; category: string; program?: ProgramId | null; food?: string | null }) {
  const [open, setOpen] = useState(false);
  const { data: cfg } = useQuery<{ ai?: boolean }>({ queryKey: ["/api/config"] });
  useEffect(() => setOpen(false), [icao, category]);
  if (!["eat", "do", "stay"].includes(category) || !cfg?.ai) return null;
  const f = food && isFocus(food) && focusCategory(food) === category ? food : null;
  return (
    <div className="space-y-3" data-testid={`section-more-ai-${icao}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid={`button-more-ai-${icao}`}
        className={cn("inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border text-sm font-semibold hover-elevate", open ? "border-foreground/30 bg-muted" : "border-dashed border-violet-400/70 text-violet-700 dark:text-violet-300")}>
        <Sparkles className="h-4 w-4" />{open ? "Hide AI picks" : `More places at ${icao}${f ? ` · ${focusLabel(f)}` : ""}`}
      </button>
      {open && <AiPicksList icao={icao} category={category} program={program} food={f} on alongside />}
    </div>
  );
}

export function AiPicksPanel({ icao, category, program, food }: { icao: string; category: string; program?: ProgramId | null; food?: string | null }) {
  const pref = useAiPref();
  const [asked, setAsked] = useState(false);
  const { data: cfg } = useQuery<{ ai?: boolean }>({ queryKey: ["/api/config"] });
  const on = ["eat", "do", "stay"].includes(category) && !!cfg?.ai;
  const want = pref === "ai" || asked;
  useEffect(() => setAsked(false), [icao, category]);
  if (on && !want) return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5" data-testid={`box-ai-offer-${icao}`}>
      <p className="text-xs text-muted-foreground">No crew picks here yet. AI can suggest real places, clearly tagged.</p>
      <button type="button" onClick={() => setAsked(true)} data-testid={`button-pick-ai-${icao}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-3.5 text-xs font-semibold text-white hover-elevate"><Sparkles className="h-3.5 w-3.5" />Pick with AI</button>
    </div>
  );
  return <AiPicksList icao={icao} category={category} program={program} food={food && isFocus(food) && focusCategory(food) === category ? food : null} on={on} />;
}

function AiPicksList({ icao, category, program, food, on, alongside }: { icao: string; category: string; program?: ProgramId | null; food?: string | null; on: boolean; alongside?: boolean }) {
  const { data, isLoading, refetch } = useQuery<{ status: string; picks: AiPick[]; total?: number; more?: string }>({
    queryKey: [`/api/ai-picks?icao=${icao}&cat=${category}${food ? `&food=${food}` : ""}${alongside ? "&all=1" : ""}`], enabled: on, staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.status === "pending" || q.state.data?.more === "pending" ? 5000 : false),
  });
  if (!on || isLoading || !data || data.status === "crew" || data.status === "off") return null;
  const picks = program ? data.picks.filter((p) => programOf(p) === program) : data.picks;
  if (data.status === "pending" && !picks.length) return (
    <p className="flex items-start gap-2 rounded-xl bg-violet-500/10 px-3 py-2.5 text-xs" data-testid="text-ai-search-pending">
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-violet-600" />No crew has listed one at {icao} yet. Finding AI picks, usually under a minute.
    </p>
  );
  if (!picks.length && data.status === "ready") return (
    <div className="space-y-2 rounded-xl border border-dashed border-violet-400/60 px-3 py-3" data-testid={`box-ai-none-${icao}`}>
      <p className="text-xs text-muted-foreground">{food ? `No ${focusLabel(food)} AI picks at ${icao} yet.` : program ? `No ${programShort(program)} hotels in the AI picks at ${icao}.` : `No AI picks here.`}</p>
      {category !== "stay" && <FindMore icao={icao} initial={food || ""} pending={data.more === "pending"} testId={`find-more-search-${icao}`} />}
    </div>
  );
  if (!picks.length) return data.status === "failed" ? (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5" data-testid={`box-ai-failed-${icao}`}>
      <p className="text-xs text-muted-foreground">AI couldn't find picks at {icao} just now. Try again in a couple of minutes.</p>
      <button type="button" onClick={() => refetch()} className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid={`button-ai-retry-${icao}`}>Try again</button>
    </div>
  ) : null;
  return (
    <section className="space-y-3" data-testid={`section-ai-picks-${icao}`}>
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
        <span>{alongside ? "AI picks near crew listings above." : "No crew picks here yet, so these are AI picks."} They aren't crew-rated: check hours before you go, and add the ones you try so they become crew picks.{picks.some((p) => p.ai.sources.some((u) => u.includes("openstreetmap.org"))) && <> Places from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">© OpenStreetMap contributors</a>.</>}</span></p>
      {picks.map((p) => <AiCard key={p.id} spot={p} />)}
      {category !== "stay" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-violet-400/60 px-3 py-2.5" data-testid={`box-find-more-${icao}`}>
          <p className="text-[11px] text-muted-foreground">{data.more === "pending" ? "Finding more places, usually under a minute." : "Want something different?"}</p>
          <FindMore icao={icao} initial={food || ""} pending={data.more === "pending"} testId={`find-more-search-${icao}`} />
        </div>
      )}
    </section>
  );
}
