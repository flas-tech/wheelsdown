import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { ExternalLink, Loader2, MapPin, Plus, Sparkles, Users } from "lucide-react";
import type { SpotWithStats } from "@shared/schema";
import { MEAL_LABEL } from "@shared/briefing";
import { costRange, costText } from "@shared/cost";
import { programOf, programShort, type ProgramId } from "@shared/loyalty";
import { CAT_META, fmtMinutes } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { AiPick } from "@/lib/briefPdf";

/** "Crew pick" (listed and rated by crews) or "AI pick" (suggested where no crew has listed anything yet). */
export function PickTag({ ai, className }: { ai: boolean; className?: string }) {
  return ai ? (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300", className)} title="Suggested by AI because no crew has listed a place here yet" data-testid="tag-ai-pick"><Sparkles className="h-3 w-3" />AI pick</span>
  ) : (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300", className)} title="Listed and rated by crews" data-testid="tag-crew-pick"><Users className="h-3 w-3" />Crew pick</span>
  );
}

/** Rewards-program chip on hotels (Hilton, Marriott…), read from the hotel's name. */
export function ProgramChip({ spot }: { spot: Pick<SpotWithStats, "category" | "name" | "description" | "website" | "id"> }) {
  const p = programOf(spot);
  if (!p) return null;
  return <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-sky-800 dark:text-sky-300" data-testid={`text-program-${spot.id}`}>{programShort(p)}</span>;
}

function AiCard({ spot }: { spot: AiPick }) {
  const M = CAT_META[spot.category as keyof typeof CAT_META];
  const out = spot.website || `https://maps.apple.com/?q=${encodeURIComponent(spot.name + " " + (spot.address || ""))}`;
  return (
    <article className="rounded-2xl border border-dashed border-violet-400/60 bg-card p-4" data-testid={`card-ai-${-spot.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <PickTag ai />
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
      {spot.address && <a href={`https://maps.apple.com/?q=${encodeURIComponent(spot.name + " " + spot.address)}`} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><MapPin className="h-3 w-3" />{spot.address}</a>}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <a href={out} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" />{spot.website ? "Website" : "Maps"}</a>
        <Link href={`/add/${spot.icao}?name=${encodeURIComponent(spot.name)}&cat=${spot.category}`} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`link-ai-add-${-spot.id}`}><Plus className="h-3.5 w-3.5" />Been here? Add it for crews</Link>
      </div>
    </article>
  );
}

export type AiPref = "crew" | "ai";
/** The member's AI setting: "crew" (default) = AI picks only when asked; "ai" = fill gaps automatically. */
export function useAiPref() {
  const { me } = useAuth();
  const { data } = useQuery<{ pref: AiPref }>({ queryKey: ["/api/me/ai-pref"], enabled: !!me, staleTime: 5 * 60_000 });
  return (me && data?.pref) || "crew";
}

/** Logbook setting: Prefer crew or Prefer AI. */
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
export function AiPicksPanel({ icao, category, program }: { icao: string; category: string; program?: ProgramId | null }) {
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
  return <AiPicksList icao={icao} category={category} program={program} on={on} />;
}

function AiPicksList({ icao, category, program, on }: { icao: string; category: string; program?: ProgramId | null; on: boolean }) {
  const { data, isLoading } = useQuery<{ status: string; picks: AiPick[] }>({
    queryKey: [`/api/ai-picks?icao=${icao}&cat=${category}`], enabled: on, staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 5000 : false),
  });
  if (!on || isLoading || !data || data.status === "crew" || data.status === "off") return null;
  const picks = program ? data.picks.filter((p) => programOf(p) === program) : data.picks;
  if (data.status === "pending" && !picks.length) return (
    <p className="flex items-start gap-2 rounded-xl bg-violet-500/10 px-3 py-2.5 text-xs" data-testid="text-ai-search-pending">
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-violet-600" />No crew has listed one at {icao} yet. Finding AI picks, usually under a minute.
    </p>
  );
  if (!picks.length) return null;
  return (
    <section className="space-y-3" data-testid={`section-ai-picks-${icao}`}>
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
        <span>No crew picks here yet, so these are AI picks. They aren't crew-rated: check hours before you go, and add the ones you try so they become crew picks.</span></p>
      {picks.map((p) => <AiCard key={p.id} spot={p} />)}
    </section>
  );
}
