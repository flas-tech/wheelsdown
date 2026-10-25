import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import {
  ArrowLeft, ChevronRight, ClipboardList, FileDown, Link2, Loader2, MapPin, Plus, RefreshCw, Share2, Trash2, X, Plane, Lightbulb, Heart, Sparkles, Users, ExternalLink,
  ChevronUp, ChevronDown, Utensils, Compass, BedDouble, CheckCircle2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { matchesFocus, focusLabel, focusCategory } from "@shared/focus";
import { CUISINES } from "@shared/cuisine";
import { ACTIVITIES } from "@shared/activities";
import { LAYOVERS, type LayoverId, type SpotWithStats } from "@shared/schema";
import { costRange, costText, paceLabel, paceOf } from "@shared/cost";
import { LAYOVER_PLAN, MEAL_LABEL, pickScore } from "@shared/briefing";
import { apiRequest, queryClient, IS_STATIC } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CAT_META, Chip, Stars, fmtMinutes, totalMinutes } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DirectionsButton } from "@/lib/directions";
import { PdfPreviewDialog } from "@/lib/pdfPreview";
import { drawStaticMap, PIN_COLORS } from "@/lib/staticMap";
import { buildBriefPdf, shareOrDownload, stopPins, groupPins, PICK_GROUPS, layoverText, routeText, CAT_NAMES, isAi, isAiAdded, looksAi, aiReason, type AiPick, type BriefFull, type BriefStopFull } from "@/lib/briefPdf";
import { errText } from "./add";
import { PickTag, AiAddedTag, fboRecTagFor, isFboAdded, FindMore, aiAddHref } from "@/lib/aiPicks";
import { useTrip } from "@/lib/experience";
import { crewUpHref, fmtArrive, sheetWords } from "@/lib/tripNav";
import { TripSheetTop, CrewPlanRows, CrewPlansSection } from "./tripHome";
import type { Meetup } from "@shared/layover";
import { noteVisit } from "@/lib/visits";

type StopInput = { icao: string; layover: LayoverId; nights?: number; picks: number[]; ai?: boolean; aiAdd?: number[]; aiHide?: number[]; order?: number[]; arriveDate?: string | null; arriveTime?: string | null };
const uniq = (a: number[]) => Array.from(new Set(a));
type BriefSummary = { id: number; title: string; stops: { icao: string; layover: LayoverId; place?: string; arriveDate?: string | null }[]; updatedAt: number };
const parseCodes = (r: string) => r.toUpperCase().split(/[^A-Z0-9]+/).filter((c) => c.length === 3 || c.length === 4).slice(0, 12);
const appUrl = () => `${window.location.origin}${window.location.pathname}`;
const toInput = (b: BriefFull): StopInput[] => b.stops.map((s) => ({ icao: s.icao, layover: s.layover as LayoverId, nights: s.nights, picks: s.picks.map((p) => p.id), ...(s.ai != null ? { ai: s.ai } : {}), ...(s.aiAdd?.length ? { aiAdd: s.aiAdd } : {}), ...(s.aiHide?.length ? { aiHide: s.aiHide } : {}), ...(s.order?.length ? { order: s.order } : {}), ...(s.arriveDate ? { arriveDate: s.arriveDate, arriveTime: s.arriveTime || null } : {}) }));

/** Refetch every few seconds while AI picks are still being found for a stop (they take about a minute). */
const aiPolling = (q: { state: { data?: BriefFull } }) => (q.state.data?.stops.some((s) => s.aiStatus === "pending" || s.aiMoreStatus === "pending") ? 2500 : false);

// ---------------- delete (two taps, no browser pop-up) ----------------
function useDeleteBriefing(onDone?: () => void) {
  const { toast } = useToast();
  const w = sheetWords(useTrip());
  return useMutation({
    mutationFn: async (bid: number) => (await apiRequest("DELETE", `/api/briefings/${bid}`)).json(),
    onSuccess: (_r, bid) => {
      queryClient.setQueryData<BriefSummary[]>(["/api/briefings"], (old) => old?.filter((b) => b.id !== bid));
      queryClient.removeQueries({ queryKey: ["/api/briefings", String(bid)] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"], exact: true });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/preview/") });
      toast({ title: w("Briefing deleted"), description: "Its shared link no longer works." });
      onDone?.();
    },
    onError: (e: Error) => toast({ title: w("Couldn't delete the briefing"), description: errText(e), variant: "destructive" }),
  });
}

/** Four-tab preview: a trip sheet tile with every stop (airport, city, date) and an easy delete:
 *  tap the trash, the tile turns into a plain Delete / Keep choice that stays until you answer. */
function TripTile({ b }: { b: BriefSummary }) {
  const [ask, setAsk] = useState(false);
  const del = useDeleteBriefing();
  const name = b.title || routeText(b);
  if (ask) return (
    <div className="rounded-2xl border border-destructive/50 bg-destructive/5 p-4 space-y-3" data-testid={`row-brief-${b.id}`}>
      <p className="text-sm">Delete <span className="font-semibold">{name}</span>? This can't be undone.</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => del.mutate(b.id)} disabled={del.isPending} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-60" data-testid={`button-brief-delete-confirm-${b.id}`}>
          {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete
        </button>
        <button type="button" onClick={() => setAsk(false)} disabled={del.isPending} className="h-11 rounded-full border border-border text-sm font-semibold hover-elevate" data-testid={`button-brief-delete-cancel-${b.id}`}>Keep it</button>
      </div>
    </div>
  );
  const today = new Date().toLocaleDateString("en-CA");
  return (
    <div className="flex items-stretch rounded-2xl border border-card-border bg-card" data-testid={`row-brief-${b.id}`}>
      <Link href={`/brief/${b.id}`} className="min-w-0 flex-1 space-y-1.5 rounded-l-2xl p-4 hover-elevate" data-testid={`link-brief-${b.id}`}>
        <p className="truncate text-sm font-semibold">{name}</p>
        <ul className="space-y-1">
          {b.stops.map((s, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="font-code font-bold">{s.icao}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.place || ""}</span>
              <span className={cn("shrink-0", s.arriveDate === today ? "font-semibold text-primary" : "text-muted-foreground")}>{s.arriveDate === today ? "Today" : s.arriveDate ? fmtArrive({ arriveDate: s.arriveDate }) : "No date"}</span>
            </li>
          ))}
        </ul>
      </Link>
      <button type="button" onClick={() => setAsk(true)} aria-label={`Delete ${name}`} className="grid w-12 shrink-0 place-items-center rounded-r-2xl border-l border-border text-muted-foreground hover:text-destructive hover-elevate" data-testid={`button-brief-delete-${b.id}`}>
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function DeleteBriefing({ id, onDone, compact }: { id: number; onDone?: () => void; compact?: boolean }) {
  const [ask, setAsk] = useState(false);
  const del = useDeleteBriefing(onDone);
  const trip = useTrip(); const w = sheetWords(trip);
  // the confirm used to vanish after 6 s, which read as "delete doesn't work"; in the preview it waits for you
  useEffect(() => { if (!ask || trip) return; const t = setTimeout(() => setAsk(false), 6000); return () => clearTimeout(t); }, [ask, trip]);
  if (compact && !ask) {
    return (
      <button type="button" onClick={() => setAsk(true)} aria-label={w("Delete briefing")} data-testid={`button-brief-delete-${id}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover-elevate">
        <Trash2 className="h-4 w-4" />
      </button>
    );
  }
  if (!ask) {
    return (
      <button type="button" onClick={() => setAsk(true)} className="w-full h-10 rounded-full border border-border text-sm text-muted-foreground hover-elevate inline-flex items-center justify-center gap-1.5" data-testid="button-brief-delete">
        <Trash2 className="h-4 w-4" /> {w("Delete briefing")}
      </button>
    );
  }
  return (
    <div className={cn("flex items-center gap-1.5", compact ? "shrink-0" : "w-full rounded-2xl border border-destructive/40 bg-destructive/5 p-2.5")} data-testid={`panel-brief-delete-${id}`}>
      {!compact && <p className="flex-1 text-xs text-muted-foreground pl-1">Delete for good? Shared links stop working.</p>}
      <button type="button" onClick={() => del.mutate(id)} disabled={del.isPending} data-testid={`button-brief-delete-confirm-${id}`}
        className="h-9 rounded-full bg-destructive px-3.5 text-xs font-semibold text-destructive-foreground hover-elevate disabled:opacity-60">
        {del.isPending ? "Deleting…" : "Delete"}
      </button>
      <button type="button" onClick={() => setAsk(false)} className="h-9 rounded-full border border-border px-3 text-xs hover-elevate" data-testid={`button-brief-delete-cancel-${id}`}>Cancel</button>
    </div>
  );
}

// ---------------- list ----------------
export function BriefListPage() {
  const { me, openAuth, loading } = useAuth();
  const { data, isLoading } = useQuery<BriefSummary[]>({ queryKey: ["/api/briefings"], enabled: !!me });
  const trip = useTrip(); const w = sheetWords(trip);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{w("Trip briefings")}</h1>
        {trip ? <p className="text-sm text-muted-foreground mt-1">Plan your layover: enter the airports and the app picks crew-rated places for each stop, with a map and a PDF to share.</p> : <p className="text-sm text-muted-foreground mt-1">Enter the routing and how long you're on the ground at each stop. Wheelsdown builds a layover plan from crew picks, with a map and a PDF for the PIC to send the crew.</p>}
      </header>
      {!loading && !me ? (
        <div className="rounded-2xl border border-card-border bg-card p-5 text-center space-y-3" data-testid="panel-brief-signin">
          <ClipboardList className="mx-auto h-6 w-6 text-primary" />
          <p className="text-sm font-semibold">{w("Sign in to build briefings")}</p>
          <p className="text-xs text-muted-foreground">{trip ? "Trip sheets" : "Briefings"} are saved to your Logbook so you can update them and resend.</p>
          <button onClick={() => openAuth()} className="h-10 rounded-full taxi-sign px-5 text-sm font-semibold hover-elevate" data-testid="button-brief-signin">Sign in</button>
        </div>
      ) : (
        <>
          {trip ? <TripSheetTop /> : <Link href="/brief/new" data-testid="link-brief-new" className="flex items-center justify-between gap-3 rounded-2xl taxi-sign p-4 hover-elevate">
            <span className="flex items-center gap-3"><Plus className="h-5 w-5" /><span><span className="block text-sm font-semibold">New trip briefing</span><span className="block text-xs opacity-80">Routing, layovers, map, PDF</span></span></span>
            <ChevronRight className="h-5 w-5" />
          </Link>}
          <section className="space-y-2">
            <h2 className={trip ? "text-xs font-semibold uppercase tracking-wider text-muted-foreground" : "text-sm font-semibold"}>{trip ? "Your trip sheets" : "Saved"}</h2>
            {isLoading && <Skeleton className="h-16 rounded-2xl" />}
            {data && data.length === 0 && <p className="text-sm text-muted-foreground">{w("No briefings yet.")}</p>}
            {trip ? data?.map((b) => <TripTile key={b.id} b={b} />) : data?.map((b) => (
              <div key={b.id} className="flex items-center gap-1 rounded-2xl border border-card-border bg-card pr-2" data-testid={`row-brief-${b.id}`}>
                <Link href={`/brief/${b.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl p-4 hover-elevate" data-testid={`link-brief-${b.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{b.title || routeText(b)}</p>
                    <p className="font-code text-xs text-muted-foreground truncate">{routeText(b)}</p>
                    <p className="text-[11px] text-muted-foreground">Updated {new Date(b.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
                <DeleteBriefing id={b.id} compact />
              </div>
            ))}
          </section>
          {trip && <CrewPlansSection />}
        </>
      )}
    </div>
  );
}

// ---------------- route form (new + change routing) ----------------
function RouteForm({ initial, initialTitle, busy, onSubmit, submitLabel }: {
  initial?: StopInput[]; initialTitle?: string; busy: boolean; submitLabel: string;
  onSubmit: (title: string, stops: StopInput[]) => void;
}) {
  const [route, setRoute] = useState(() => {
    if (initial) return initial.map((s) => s.icao).join(" ");
    const pre = sessionStorage.getItem("wd-brief-prefill") || ""; sessionStorage.removeItem("wd-brief-prefill"); return pre;
  });
  const [title, setTitle] = useState(initialTitle || "");
  const trip = useTrip(); // four-tab preview: when you land at each stop (airport local), for Home and Crew Up
  type L = { layover: LayoverId; nights?: number; arriveDate?: string | null; arriveTime?: string | null };
  const [layovers, setLayovers] = useState<Record<string, L>>(
    Object.fromEntries((initial || []).map((s, i) => [`${i}:${s.icao}`, { layover: s.layover, nights: s.nights, arriveDate: s.arriveDate, arriveTime: s.arriveTime }])),
  );
  const codes = parseCodes(route);
  const keyOf = (i: number, c: string) => `${i}:${c}`;
  const get = (i: number, c: string) => layovers[keyOf(i, c)] || { layover: (i === codes.length - 1 && codes.length > 1 ? "overnight" : "hours") as LayoverId };
  const setL = (i: number, c: string, v: L) => setLayovers({ ...layovers, [keyOf(i, c)]: { ...get(i, c), ...v } });
  const prevPicks = new Map((initial || []).map((s) => [s.icao, s.picks]));

  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      if (!codes.length) return;
      // keep existing picks for a stop whose airport and layover didn't change; re-pick the rest
      onSubmit(title.trim(), codes.map((c, i) => {
        const v = get(i, c);
        const same = initial?.find((s) => s.icao === c && s.layover === v.layover);
        const was = initial?.find((s) => s.icao === c);
        return { icao: c, layover: v.layover, nights: v.nights, picks: same ? prevPicks.get(c) || [] : [], ...(was?.ai != null ? { ai: was.ai } : {}), ...(v.arriveDate ? { arriveDate: v.arriveDate, arriveTime: v.arriveTime || null } : {}) };
      }));
    }} data-testid="form-brief-route">
      <div>
        <label className="text-xs font-medium text-muted-foreground" htmlFor="brief-route">Routing</label>
        <input id="brief-route" value={route} onChange={(e) => setRoute(e.target.value.toUpperCase())} placeholder="KOPF KTEB KASE" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          className="mt-1.5 w-full h-12 rounded-xl border border-input bg-card px-3.5 font-code text-base tracking-wider focus:outline-none focus:ring-2 focus:ring-ring" data-testid="input-brief-route" />
        <p className="mt-1 text-[11px] text-muted-foreground">Every airport where you'll be on the ground. Leave out home base if you don't need it.</p>
      </div>
      {codes.length > 0 && (
        <div className="space-y-3">
          {codes.map((c, i) => {
            const v = get(i, c);
            return (
              <div key={keyOf(i, c)} className="rounded-2xl border border-card-border bg-card p-3.5" data-testid={`stop-input-${i}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-code text-xs font-bold rounded-md taxi-sign px-1.5 py-0.5">{c}</span>
                  <span className="text-xs text-muted-foreground">Stop {i + 1} · time on the ground</span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                  {LAYOVERS.map((l) => (
                    <Chip key={l.id} active={v.layover === l.id} onClick={() => setL(i, c, { layover: l.id, nights: l.id === "multi" ? v.nights || 2 : undefined })} testId={`chip-layover-${i}-${l.id}`} className="text-xs">
                      {l.label} <span className="ml-1 opacity-70">{l.sub}</span>
                    </Chip>
                  ))}
                </div>
                {v.layover === "multi" && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Nights</span>
                    {[2, 3, 4, 5, 7].map((n) => <Chip key={n} active={v.nights === n} onClick={() => setL(i, c, { layover: "multi", nights: n })} className="text-xs font-code" testId={`chip-nights-${i}-${n}`}>{n}</Chip>)}
                  </div>
                )}
                {trip && <ArriveInputs i={i} date={v.arriveDate || ""} onChange={(d) => setL(i, c, { layover: v.layover, arriveDate: d || null, arriveTime: null })} />}
              </div>
            );
          })}
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-muted-foreground" htmlFor="brief-title">Trip name <span className="font-normal">(optional)</span></label>
        <input id="brief-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. N123AB Aspen ski trip"
          className="mt-1.5 w-full h-11 rounded-xl border border-input bg-card px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring" data-testid="input-brief-title" />
      </div>
      <button type="submit" disabled={!codes.length || busy} className="w-full h-12 rounded-full taxi-sign text-base font-semibold disabled:opacity-50 hover-elevate" data-testid="button-brief-build">
        {busy ? "Building…" : submitLabel}
      </button>
    </form>
  );
}

/** When you land (local time at that airport). Optional: Home uses it for your next trip, Crew Up to plan ahead. */
function ArriveInputs({ i, date, onChange, compact }: { i: number; date: string; onChange: (date: string) => void; compact?: boolean }) {
  return (
    <div className={cn("flex items-end gap-2", compact ? "" : "mt-3")} data-testid={`arrive-${i}`}>
      <label className="min-w-0 flex-1 text-[11px] font-medium text-muted-foreground">Landing date (optional)
        <input type="date" value={date} onChange={(e) => onChange(e.target.value)} className="mt-1 block h-10 w-full min-w-0 rounded-xl border border-input bg-background px-2.5 text-base text-foreground" data-testid={`input-arrive-date-${i}`} />
      </label>
      {date && <button type="button" onClick={() => onChange("")} className="h-10 shrink-0 rounded-xl border border-border px-2.5 text-xs hover-elevate" aria-label="Clear the date" data-testid={`button-arrive-clear-${i}`}><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

// ---------------- editor ----------------
export function BriefEditorPage() {
  const [, paramsId] = useRoute("/brief/:id");
  const isNew = !paramsId || paramsId.id === "new";
  const id = isNew ? undefined : Number(paramsId!.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { me, requireAuth, loading } = useAuth();
  const [editRoute, setEditRoute] = useState(false);
  const trip = useTrip(); const w = sheetWords(trip);
  groupPins(trip);

  const { data: brief, isLoading } = useQuery<BriefFull>({ queryKey: ["/api/briefings", String(id)], enabled: !!me && !!id, refetchInterval: aiPolling });
  // four-tab preview: Crew Up plans at each stop (yours, and ones crew picked you for) show on the trip sheet
  const icaos = brief ? Array.from(new Set(brief.stops.map((x) => x.icao))).join(",") : "";
  const { data: crewAt } = useQuery<{ byIcao: Record<string, Meetup[]> }>({ queryKey: [`/api/preview/crewup-at?icaos=${icaos}`], enabled: trip && !!icaos, staleTime: 30_000, retry: false });

  const save = useMutation({
    mutationFn: async (p: { title: string; stops: StopInput[]; suggest?: boolean; avoid?: Record<number, number[]> }) => {
      let stops = p.stops;
      if (p.suggest) {
        const need = stops.filter((s) => !s.picks.length);
        if (need.length) {
          const avoid = stops.map((s, i) => (!s.picks.length ? p.avoid?.[i] || [] : null)).filter((x) => x !== null);
          const sug = (await (await apiRequest("POST", "/api/briefings/suggest", { title: p.title, stops: need, avoid })).json()) as { stops: StopInput[] };
          let k = 0;
          stops = stops.map((s) => (s.picks.length ? s : { ...s, icao: sug.stops[k].icao, picks: sug.stops[k++].picks }));
        }
      }
      return (await (await apiRequest("POST", "/api/briefings", { id, title: p.title, stops })).json()) as BriefFull;
    },
    onSuccess: (b) => {
      queryClient.setQueryData(["/api/briefings", String(b.id)], b);
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"], exact: true });
      setEditRoute(false);
      if (isNew) navigate(`/brief/${b.id}`);
    },
    onError: (e: Error) => toast({ title: w("Couldn't save the briefing"), description: errText(e), variant: "destructive" }),
  });


  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!me) return <BriefListPage />;

  if (isNew) {
    return (
      <div className="space-y-5">
        <Link href="/brief" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-briefs"><ArrowLeft className="h-4 w-4" /> {w("Briefings")}</Link>
        <header>
          <h1 className="text-xl font-semibold">{w("New trip briefing")}</h1>
          <p className="text-sm text-muted-foreground mt-1">We'll pick crew-rated spots that fit the time at each stop. You can swap anything before you send it.</p>
        </header>
        <RouteForm busy={save.isPending} submitLabel={w("Build briefing")} onSubmit={(title, stops) => requireAuth(() => save.mutate({ title, stops, suggest: true }), w("Sign in to build briefings."))} />
      </div>
    );
  }

  if (isLoading || !brief) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-64 rounded-2xl" /></div>;

  const input = toInput(brief);
  const update = (stops: StopInput[], suggest = false) => save.mutate({ title: brief.title, stops, suggest });

  return (
    <div className="space-y-5">
      <Link href="/brief" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-briefs"><ArrowLeft className="h-4 w-4" /> {w("Briefings")}</Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold leading-tight" data-testid="text-brief-title">{brief.title || w("Trip briefing")}</h1>
        <p className="font-code text-sm font-bold tracking-wide" data-testid="text-brief-route">{routeText(brief)}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <button onClick={() => setEditRoute(!editRoute)} className="text-primary font-medium" data-testid="button-brief-edit-route">{editRoute ? "Close" : "Change routing or layovers"}</button>
          {save.isPending && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Saving</span>}
        </div>
      </header>

      {editRoute && (
        <div className="rounded-2xl border border-primary/40 p-4">
          <RouteForm initial={input} initialTitle={brief.title} busy={save.isPending} submitLabel={w("Update briefing")} onSubmit={(title, stops) => save.mutate({ title, stops, suggest: true })} />
        </div>
      )}

      {!trip && <ExportBar brief={brief} preparedBy={me.displayName} />}

      <BriefOverview brief={brief} />

      {brief.stops.map((st, i) => {
        const put = (f: (s: StopInput) => StopInput, suggest = false) => update(input.map((s, k) => (k === i ? f(s) : s)), suggest);
        const dropOrder = (s: StopInput, id: number) => (s.order || []).filter((x) => x !== id);
        return (
          <StopSection key={`${i}-${st.icao}`} stop={st} index={i} busy={save.isPending} plans={crewAt?.byIcao[st.icao]}
            onReorder={(a) => put((s) => {
              const crew = a.filter((x) => x > 0 && s.picks.includes(x));
              return { ...s, order: a, picks: [...crew, ...s.picks.filter((p) => !crew.includes(p))] };
            })}
            // crew listings leave the plan; AI picks added from More places are dropped; automatic AI picks stay removed
            onRemove={(spot) => put((s) => !isAi(spot) ? { ...s, picks: s.picks.filter((p) => p !== spot.id), order: dropOrder(s, spot.id) }
              : (spot as AiPick).ai.extra ? { ...s, aiAdd: (s.aiAdd || []).filter((x) => x !== -spot.id), order: dropOrder(s, spot.id) }
              : { ...s, aiHide: uniq([...(s.aiHide || []), -spot.id]).slice(-40), order: dropOrder(s, spot.id) })}
            onMove={(keys, sid, dir) => put((s) => {
              const a = [...keys]; const j = a.indexOf(sid); const t = j + dir;
              if (j < 0 || t < 0 || t >= a.length) return s;
              [a[j], a[t]] = [a[t], a[j]];
              const crew = a.filter((x) => x > 0 && s.picks.includes(x));
              return { ...s, order: a, picks: [...crew, ...s.picks.filter((p) => !crew.includes(p))] };
            })}
            onAddPick={(sid) => put((s) => ({ ...s, picks: [...s.picks, sid] }))}
            onResuggest={() => {
              const was = input[i].picks;
              save.mutate({ title: brief.title, stops: input.map((s, k) => (k === i ? { ...s, picks: [], aiHide: [], order: [] } : s)), suggest: true, avoid: { [i]: was } }, {
                onSuccess: (b) => {
                  const fv = new Set(b.stops[i]?.favoriteIds || []);
                  const now = (b.stops[i]?.picks || []).map((x) => x.id).filter((x) => x > 0 && !fv.has(x));
                  const same = now.every((x) => was.includes(x));
                  toast({ title: same ? `No other crew picks at ${st.icao} yet` : `New picks at ${st.icao}`, description: same ? "These are the only crew-rated places that fit. Add places, or ask AI for more." : "Swapped in other crew-rated places. Your favorites stay." });
                },
              });
            }}
            onAi={(on) => put((s) => ({ ...s, ai: on, ...(on ? {} : { aiAdd: [], aiHide: [], order: (s.order || []).filter((x) => x > 0) }) }))}
            onAiAdd={(rowId) => put((s) => ({ ...s, aiAdd: uniq([...(s.aiAdd || []), rowId]).slice(-20), aiHide: (s.aiHide || []).filter((x) => x !== rowId) }))}
            onArrive={(d) => put((s) => ({ ...s, arriveDate: d || null, arriveTime: null }))} />
        );
      })}

      {trip && <ExportBar brief={brief} preparedBy={me.displayName} />}
      <FinalizeBar brief={brief} preparedBy={me.displayName} />

      <DeleteBriefing id={Number(id)} onDone={() => navigate("/brief")} />
    </div>
  );
}

// ---------------- export / share ----------------
function ExportBar({ brief, preparedBy, onShared }: { brief: BriefFull; preparedBy?: string; onShared?: () => void }) {
  const { toast } = useToast();
  const w = sheetWords(useTrip());
  const [, navigate] = useLocation();
  const [pdf, setPdf] = useState<{ blob: Blob; fileName: string; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fresh = pdf && pdf.key === brief.updatedAt;
  const shareUrl = `${appUrl()}#/b/${brief.shareToken}`;

  const [previewing, setPreviewing] = useState(false);
  async function prepare(thenPreview = false) {
    setBusy(true);
    try {
      const out = await buildBriefPdf(brief, { appUrl: appUrl(), preparedBy });
      setPdf({ ...out, key: brief.updatedAt });
      if (thenPreview) setPreviewing(true);
      // count one sponsor impression per stop that shows a sponsor line
      brief.stops.forEach((s) => s.sponsor && apiRequest("POST", `/api/ads/${s.sponsor.id}/impression`).catch(() => {}));
    } catch (e) {
      toast({ title: "Couldn't build the PDF", description: errText(e), variant: "destructive" });
    } finally { setBusy(false); }
  }
  async function send() {
    if (!pdf) return;
    const r = await shareOrDownload(pdf.blob, pdf.fileName, brief.title || w("Trip briefing"));
    if (r === "downloaded") toast({ title: "PDF downloaded", description: pdf.fileName });
    if (r !== "cancelled") onShared?.();
  }
  async function copyLink() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      try { await nav.share({ url: shareUrl, title: brief.title || w("Trip briefing") }); onShared?.(); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(shareUrl); toast({ title: "Link copied", description: w("Anyone with the link can view this briefing.") }); }
    catch { toast({ title: "Share link", description: shareUrl }); }
    onShared?.();
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-3.5 space-y-2.5" data-testid="panel-brief-export">
      <div className="grid grid-cols-2 gap-2">
        {fresh ? (
          <button onClick={send} className="h-11 rounded-full taxi-sign text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover-elevate" data-testid="button-brief-share-pdf">
            <Share2 className="h-4 w-4" /> Share PDF
          </button>
        ) : (
          <button onClick={() => prepare()} disabled={busy} className="h-11 rounded-full taxi-sign text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover-elevate disabled:opacity-60" data-testid="button-brief-pdf">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} {busy ? "Building PDF…" : "Prepare PDF"}
          </button>
        )}
        <button onClick={copyLink} className="h-11 rounded-full border border-border text-sm font-medium inline-flex items-center justify-center gap-1.5 hover-elevate" data-testid="button-brief-link">
          <Link2 className="h-4 w-4" /> Share link
        </button>
      </div>
      <button type="button" onClick={() => (fresh ? setPreviewing(true) : prepare(true))} disabled={busy}
        className="h-10 w-full rounded-full border border-border text-sm font-medium inline-flex items-center justify-center gap-1.5 hover-elevate disabled:opacity-60" data-testid="button-brief-preview-pdf">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview PDF
      </button>
      <PdfPreviewDialog blob={fresh ? pdf!.blob : null} open={previewing && !!fresh} onOpenChange={setPreviewing} onSend={send} onExit={() => navigate("/brief")} title={brief.title || w("Trip briefing")} />
      <p className="text-[11px] text-muted-foreground">
        {fresh ? "Ready. Preview it first, or Share PDF to open Messages, Mail and AirDrop on iPhone." : "The PDF has a cover with the routing, then one page per stop with the map and picks."}
        {IS_STATIC ? " Demo: shared links only open in this browser." : ""}
      </p>
    </div>
  );
}

// ---------------- maps ----------------
const PinsMap = lazy(() => import("@/lib/pinsMap"));
/** Four-tab preview: a map you can drag and pinch-zoom (crew feedback, round 6). Members keep the static picture. */
function MapCanvas(props: { pins: ReturnType<typeof stopPins>["pins"]; height?: number; route?: boolean; testId?: string }) {
  const trip = useTrip();
  const h = props.height ?? 220;
  if (!trip) return <StaticMapCanvas {...props} />;
  return (
    <Suspense fallback={<div className="w-full rounded-xl border border-border bg-muted" style={{ height: h }} data-testid={props.testId} />}>
      <PinsMap pins={props.pins} height={h} route={props.route} testId={props.testId} />
    </Suspense>
  );
}

function StaticMapCanvas({ pins, height = 220, route, testId }: { pins: ReturnType<typeof stopPins>["pins"]; height?: number; route?: boolean; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sig = JSON.stringify(pins);
  useEffect(() => {
    const c = ref.current, w = wrap.current;
    if (!c || !w) return;
    let alive = true;
    const draw = () => { if (alive) drawStaticMap(c, pins, w.clientWidth, height, { route }); };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(w);
    return () => { alive = false; ro.disconnect(); };
  }, [sig, height, route]); // eslint-disable-line
  return (
    <div ref={wrap} className="w-full overflow-hidden rounded-xl border border-border bg-muted" style={{ height }} data-testid={testId}>
      <canvas ref={ref} style={{ width: "100%", height }} role="img" aria-label="Map of briefing locations" />
    </div>
  );
}

function BriefOverview({ brief }: { brief: BriefFull }) {
  const pins = brief.stops.filter((s) => s.airport?.lat != null && s.airport?.lon != null)
    .map((s) => ({ lat: s.airport!.lat!, lng: s.airport!.lon!, label: s.icao, kind: "airport" as const }));
  if (pins.length < 2) return null;
  return <MapCanvas pins={pins} height={190} route testId="map-brief-overview" />;
}

function StopSection({ stop, index, onRemove, onAddPick, onMove, onReorder, onResuggest, onAi, onAiAdd, onArrive, busy, plans }: {
  stop: BriefStopFull; index: number; busy: boolean; plans?: Meetup[]; onReorder?: (order: number[]) => void;
  onRemove: (spot: SpotWithStats) => void; onAddPick: (id: number) => void; onMove: (keys: number[], id: number, dir: -1 | 1) => void; onResuggest: () => void; onAi: (on: boolean) => void;
  onAiAdd: (rowId: number) => void; onArrive?: (date: string) => void;
}) {
  const trip = useTrip();
  const { pins, numbered } = useMemo(() => stopPins(stop), [stop, trip]);
  const picked = new Set(stop.picks.map((p) => p.id));
  const favs = new Set(stop.favoriteIds || []);
  const others = (stop.candidates || []).filter((c) => !picked.has(c.id));
  const plan = LAYOVER_PLAN[stop.layover as LayoverId];
  const unmapped = numbered.filter((n) => !n.mapped).length;
  // four-tab preview: an AI search in progress, so new finds can pop in where you asked (and a toast when it's done)
  const [search, setSearch] = useState<AiSearch | null>(null);
  const [openReq, setOpenReq] = useState<{ kind: MoreKind; n: number } | null>(null);
  const { toast } = useToast();
  const startSearch = (cat: string) => setSearch({ cat, before: new Set((stop.aiMore || []).map((m) => m.id)), t0: Date.now(), done: false });
  const wasPending = useRef(false);
  useEffect(() => {
    const p = stop.aiMoreStatus === "pending";
    if (wasPending.current && !p && search && !search.done) {
      const n = newFinds(stop, search).length;
      setSearch({ ...search, done: true });
      toast({ title: n ? `AI found ${n} new place${n === 1 ? "" : "s"} at ${stop.icao}` : `Nothing new at ${stop.icao} this time`, description: n ? "They're in the box you asked from. Tap + to add one." : "Try a different type, or add a place you know." });
    }
    wasPending.current = p;
  }, [stop.aiMoreStatus]); // eslint-disable-line

  return (
    <section className="space-y-3" data-testid={`section-stop-${index}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-code text-sm font-bold rounded-md taxi-sign px-1.5 py-0.5">{stop.icao}</span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold">{layoverText(stop)}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground truncate">{stop.airport ? `${stop.airport.name}${stop.airport.city ? ` · ${stop.airport.city}` : ""}` : ""}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <Link href={`/add/${stop.icao}`} className="h-8 rounded-full border border-border px-2.5 text-xs inline-flex items-center gap-1 font-semibold hover-elevate" data-testid={`link-stop-add-${index}`}>
            <Plus className="h-3.5 w-3.5" /> Add spot
          </Link>
          {!trip && <button onClick={onResuggest} disabled={busy} className="h-8 rounded-full border border-border px-2.5 text-xs inline-flex items-center gap-1 hover-elevate disabled:opacity-50" data-testid={`button-resuggest-${index}`}>
            <RefreshCw className="h-3.5 w-3.5" /> Re-pick
          </button>}
        </span>
      </div>
      {plan && <p className="text-[11px] text-muted-foreground">{plan.note}</p>}
      {trip && onArrive && (
        <div className="rounded-2xl border border-card-border bg-card p-3" data-testid={`stop-when-${index}`}>
          <ArriveInputs i={index} compact date={stop.arriveDate || ""} onChange={onArrive} />
        </div>
      )}

      <MapCanvas pins={pins} testId={`map-stop-${index}`} />
      {unmapped > 0 && <p className="text-[11px] text-muted-foreground">{unmapped} pick{unmapped > 1 ? "s aren't" : " isn't"} on the map yet (no location saved). They're still in the list and the PDF.</p>}

      <AiNote stop={stop} onAi={onAi} busy={busy} />
      {numbered.length === 0 && stop.aiStatus !== "pending" && stop.aiStatus !== "offer" && (
        <div className="rounded-2xl border border-dashed border-border p-4 text-center">
          <p className="text-sm font-semibold">No crew picks at {stop.icao} yet</p>
          <Link href={`/add/${stop.icao}`} className="mt-2 inline-flex items-center gap-1.5 rounded-full taxi-sign px-3.5 py-1.5 text-xs font-semibold hover-elevate" data-testid={`link-add-at-${stop.icao}`}><Plus className="h-3.5 w-3.5" />Add a spot at {stop.icao}</Link>
        </div>
      )}

      {numbered.some((x) => looksAi(x.spot)) && <PickLegend />}
      {trip ? <GroupedPicks numbered={numbered} favs={favs} busy={busy} onRemove={onRemove} onReorder={onReorder} index={index} stop={stop} onAiAdd={onAiAdd}
        others={others} search={search} onSearch={startSearch} onClearSearch={() => setSearch(null)} onBrowse={(k) => setOpenReq({ kind: k, n: Date.now() })} /> : (
      <ol className="space-y-2">
        {numbered.map(({ n, spot }) => <PickRow key={spot.id} n={n} spot={spot} count={numbered.length}
          favorite={favs.has(spot.id)} onRemove={() => onRemove(spot)} busy={busy}
          onUp={() => onMove(numbered.map((x) => x.spot.id), spot.id, -1)} onDown={() => onMove(numbered.map((x) => x.spot.id), spot.id, 1)} />)}
      </ol>)}

      {/* one way to add anything: crew listings first, then AI picks, by type, with a way to ask AI for more */}
      <AddPlaces stop={stop} index={index} others={others} onAddCrew={onAddPick} onAddAi={onAiAdd} busy={busy} openReq={openReq} search={search} onSearch={startSearch} />

      {trip && !!plans?.length && (
        <div className="space-y-1.5" data-testid={`stop-crewplans-${index}`}>
          <p className="text-xs font-semibold">Crew plans at <span className="font-code">{stop.icao}</span></p>
          <CrewPlanRows plans={plans} onDate={stop.arriveDate} />
        </div>
      )}
      {trip && (
        <div className="grid grid-cols-2 gap-2" data-testid={`stop-actions-${index}`}>
          <Link href={crewUpHref(stop)} className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold hover-elevate" data-testid={`link-stop-crewup-${index}`}>
            <Users className="h-4 w-4" />Crew Up
          </Link>
          <button onClick={onResuggest} disabled={busy} className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-border text-sm hover-elevate disabled:opacity-50" data-testid={`button-resuggest-${index}`}>
            <RefreshCw className="h-4 w-4" />Re-pick
          </button>
        </div>
      )}

      {stop.sponsor && (
        <a href={stop.sponsor.url || "#"} target="_blank" rel="noopener noreferrer sponsored" className="block rounded-xl bg-muted/60 px-3 py-2 text-xs hover-elevate" data-testid={`sponsor-${index}`}>
          <span className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground mr-2">Sponsored</span>
          <span className="font-medium">{stop.sponsor.advertiser}</span> · {stop.sponsor.headline}
        </a>
      )}
    </section>
  );
}

/** An AI search the member started on this stop: which box (category, or "any"), what was there before, when. */
type AiSearch = { cat: string; before: Set<number>; t0: number; done: boolean };
const newFinds = (stop: BriefStopFull, q: AiSearch) => {
  const shown = new Set([...(stop.picks || []), ...(stop.aiPicks || [])].map((x) => x.id));
  return (stop.aiMore || []).filter((m) => !q.before.has(m.id) && !shown.has(m.id) && (q.cat === "any" || m.category === q.cat));
};

function AiFindRow({ m, busy, onAdd, testId, fresh }: { m: AiPick; busy: boolean; onAdd: () => void; testId?: string; fresh?: boolean }) {
  const checking = !!(m as any).ai?.draft;
  return (
    <div className={cn("flex items-center gap-2", fresh && "wd-pop")} data-testid={testId}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><span className="truncate text-xs font-semibold">{m.name}</span>
          {fresh && <span className="shrink-0 rounded-full bg-violet-600 px-1.5 text-[9px] font-bold uppercase tracking-wide text-white">{checking ? "Checking" : "New"}</span>}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{[m.milesFromField != null ? `${m.milesFromField} mi` : "", m.description || ""].filter(Boolean).join(" · ")}</span>
      </span>
      <button type="button" onClick={onAdd} disabled={busy} aria-label={`Add ${m.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border hover-elevate disabled:opacity-50" data-testid={testId ? `${testId}-add` : undefined}><Plus className="h-4 w-4" /></button>
    </div>
  );
}

/** Live AI search: what it's doing right now, and each place popping in as it's found. */
function AiSearchLive({ stop, search, label, busy, onAiAdd, onClose, testId }: { stop: BriefStopFull; search: AiSearch; label: string; busy: boolean; onAiAdd: (rowId: number) => void; onClose?: () => void; testId?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { if (search.done) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [search.done]);
  const fresh = newFinds(stop, search);
  const secs = Math.round((Date.now() - search.t0) / 1000);
  const step = search.done ? (fresh.length ? `Found ${fresh.length} new ${fresh.length === 1 ? "place" : "places"}. Tap + to add.` : "Nothing new this time. Try another type.")
    : !fresh.length ? (secs < 8 ? `Looking up ${label.toLowerCase()} on the map near ${stop.icao}…` : `Still looking near ${stop.icao}…`)
    : `Found ${fresh.length} so far. AI is checking hours and reviews…`;
  return (
    <div className="space-y-1.5" data-testid={testId} aria-live="polite">
      <div className="flex items-center gap-2">
        {search.done ? <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" /> : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-600" />}
        <p className="min-w-0 flex-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300" data-testid={testId ? `${testId}-step` : undefined}>{step}</p>
        {!search.done && <span className="font-code text-[10px] text-muted-foreground">{secs}s</span>}
        {search.done && onClose && <button type="button" onClick={onClose} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover-elevate"><X className="h-3.5 w-3.5" /></button>}
      </div>
      {!search.done && <div className="h-1 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950"><div className="wd-scan h-full w-1/3 rounded-full bg-violet-500" /></div>}
      {fresh.map((m) => <AiFindRow key={m.id} m={m} busy={busy} fresh onAdd={() => onAiAdd(-m.id)} testId={testId ? `${testId}-find-${m.id}` : undefined} />)}
    </div>
  );
}

/** Four-tab preview: one box per type (hotels, eat, do, FBO); crew picks first, then AI picks. Up/Down stay inside their box. */
function GroupedPicks({ numbered, favs, busy, onRemove, onReorder, index, stop, onAiAdd, others, search, onSearch, onClearSearch, onBrowse }: {
  stop: BriefStopFull; onAiAdd: (rowId: number) => void; others: SpotWithStats[];
  search: AiSearch | null; onSearch: (cat: string) => void; onClearSearch: () => void; onBrowse: (k: MoreKind) => void;
  numbered: ReturnType<typeof stopPins>["numbered"]; favs: Set<number>; busy: boolean; index: number;
  onRemove: (spot: SpotWithStats) => void; onReorder?: (order: number[]) => void;
}) {
  const ids = numbered.map((x) => x.spot.id);
  const groups = [...PICK_GROUPS.map(([k, label]) => ({ k: k as string, label: label as string })), { k: "other", label: "Other" }]
    .map((g) => ({ ...g, items: numbered.filter((x) => (g.k === "other" ? !PICK_GROUPS.some(([k]) => k === x.spot.category) : x.spot.category === g.k)) }))
    // eat and do always get a box (so you can ask AI even when it's empty); hotels on overnights
    .filter((g) => g.items.length || g.k === "eat" || g.k === "do" || (g.k === "stay" && (stop.layover === "overnight" || stop.layover === "multi")));
  const { data: cfg } = useQuery<{ ai?: boolean }>({ queryKey: ["/api/config"] });
  const aiOn = cfg?.ai !== false;
  const shown = new Set(numbered.map((x) => x.spot.id));
  const more = (stop.aiMore || []).filter((m) => !shown.has(m.id));
  const swap = (a: number, b: number) => { const o = [...ids]; const i = o.indexOf(a), j = o.indexOf(b); [o[i], o[j]] = [o[j], o[i]]; onReorder?.(o); };
  const rows = (list: typeof numbered) => (
    <ol className="space-y-2">
      {list.map(({ n, spot }, k) => <PickRow key={spot.id} n={n} spot={spot} count={numbered.length} first={k === 0} last={k === list.length - 1}
        favorite={favs.has(spot.id)} onRemove={() => onRemove(spot)} busy={busy}
        onUp={() => k > 0 && swap(spot.id, list[k - 1].spot.id)} onDown={() => k < list.length - 1 && swap(spot.id, list[k + 1].spot.id)} />)}
    </ol>
  );
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        if (!g.items.length && !aiOn) return null;
        const crew = g.items.filter((x) => !looksAi(x.spot)), ai = g.items.filter((x) => looksAi(x.spot));
        const M = CAT_META[g.k as keyof typeof CAT_META];
        return (
          <div key={g.k} className="rounded-2xl border border-border bg-muted/30 p-2.5 space-y-2" data-testid={`group-${g.k}-${index}`}>
            <p className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{M && <M.icon className="h-3.5 w-3.5" />}{g.label} <span className="font-normal normal-case tracking-normal">· {g.items.length}</span></p>
            {crew.length > 0 && rows(crew)}
            {ai.length > 0 && (
              <div className="space-y-2" data-testid={`group-${g.k}-ai-${index}`}>
                <p className="flex items-center gap-1 px-1 pt-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300"><Sparkles className="h-3 w-3" />AI picks</p>
                {rows(ai)}
              </div>
            )}
            {!g.items.length && <p className="px-1 text-xs text-muted-foreground">No picks here yet.</p>}
            {aiOn && g.k !== "fbo" && g.k !== "other" && (() => {
              const live = search && search.cat === g.k ? search : null;
              const fresh = live ? newFinds(stop, live) : [];
              const extra = more.filter((m) => m.category === g.k && !fresh.some((f) => f.id === m.id)).slice(0, live ? 0 : 3);
              const hiddenN = others.filter((c) => c.category === g.k).length + Math.max(0, more.filter((m) => m.category === g.k).length - extra.length - fresh.length);
              return (
                <div className="space-y-1.5 rounded-xl border border-dashed border-violet-400/60 bg-card p-2.5" data-testid={`group-${g.k}-askai-${index}`}>
                  {live ? <AiSearchLive stop={stop} search={live} label={g.label} busy={busy} onAiAdd={onAiAdd} onClose={onClearSearch} testId={`live-${g.k}-${index}`} />
                    : <p className="text-[11px] font-semibold text-muted-foreground">{g.items.length ? "Don't like what you see?" : "Nothing here yet?"}</p>}
                  {extra.map((m) => <AiFindRow key={m.id} m={m} busy={busy} onAdd={() => onAiAdd(-m.id)} testId={`group-${g.k}-aimore-${m.id}`} />)}
                  {stop.aiMoreStatus === "full" ? <p className="text-[11px] text-muted-foreground">AI has found all it keeps for {stop.icao}.</p>
                    : !(live && !live.done) && <FindMore icao={stop.icao} pending={stop.aiMoreStatus === "pending"} fixed={g.k} compact onDone={() => onSearch(g.k)} testId={`find-more-${g.k}-${index}`} />}
                  {hiddenN > 0 && (
                    <button type="button" onClick={() => onBrowse(g.k as MoreKind)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-left text-xs font-semibold hover-elevate" data-testid={`button-group-browse-${g.k}-${index}`}>
                      <span>See {hiddenN} more {g.k === "stay" ? "hotels" : g.k === "eat" ? "places to eat" : "things to do"} at {stop.icao}</span><ChevronRight className="h-4 w-4 shrink-0" />
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

function PickRow({ n, spot, count, onRemove, onUp, onDown, busy, readOnly, favorite, first, last }: {
  first?: boolean; last?: boolean;
  n: number; spot: SpotWithStats; count: number; onRemove?: () => void; onUp?: () => void; onDown?: () => void; busy?: boolean; readOnly?: boolean; favorite?: boolean;
}) {
  const M = CAT_META[spot.category as keyof typeof CAT_META];
  const ai = isAi(spot);
  const meal = ai ? (spot as AiPick).ai.meal : null;
  const extra = spot.category === "eat" ? (ai && !spot.pace ? "" : paceLabel(paceOf(spot))) : spot.category === "do" ? fmtMinutes(totalMinutes(spot)) : "";
  const outLink = spot.website || `https://maps.apple.com/?q=${encodeURIComponent(spot.name + " " + (spot.address || ""))}`;
  const went = () => noteVisit(isAi(spot) ? { id: spot.id, name: spot.name, icao: spot.icao, href: aiAddHref(spot as AiPick) } : { id: spot.id, name: spot.name, icao: spot.icao });
  return (
    <li className={cn("rounded-2xl border bg-card p-3.5", ai ? "border-dashed border-violet-400/60" : "border-card-border")} data-testid={ai ? `pick-ai-${-spot.id}` : `pick-${spot.id}`}>
      <div className="flex items-start gap-3">
        <NumBadge n={n} spot={spot} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {ai ? <a href={outLink} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold leading-snug hover:underline underline-offset-2">{spot.name}</a>
              : <Link href={`/spot/${spot.id}`} className="text-sm font-semibold leading-snug hover:underline underline-offset-2">{spot.name}</Link>}
            {spot.category !== "fbo" && (!ai || spot.cost != null) && <span className="shrink-0 text-right"><span className="block font-code text-xs font-bold text-primary">{costText(spot)}</span>{spot.cost != null && spot.cost > 0 && <span className="block text-[10px] text-muted-foreground whitespace-nowrap">{costRange(spot.category, spot.cost)}</span>}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isAiAdded(spot) ? <AiAddedTag rated={!!spot.reviewCount} /> : !ai && isFboAdded(spot) ? fboRecTagFor(spot.fboRecs) : <PickTag ai={ai} />}
            {ai && <ReasonChip spot={spot as AiPick} />}
            {meal && !(ai && (spot as AiPick).ai.slot?.meal === meal && !(spot as AiPick).ai.extra) && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold" data-testid={`text-meal-${-spot.id}`}>{MEAL_LABEL[meal]}</span>}
          </div>
          {favorite && <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400" data-testid={`text-pick-favorite-${spot.id}`}><Heart className="h-3 w-3" fill="currentColor" />Favorite{readOnly ? "" : " · always included"}</p>}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><M.icon className="h-3 w-3" />{M.label}</span>
            {spot.milesFromField ? ` · ${spot.milesFromField} mi` : ai ? "" : " · On field"}{extra ? ` · ${extra}` : ""}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            {spot.reviewCount ? <><Stars value={spot.avgRating ?? 0} size={11} /><span className="text-[11px] text-muted-foreground tabular">{spot.avgRating?.toFixed(1)} · {spot.reviewCount}</span></> : <span className="text-[11px] text-muted-foreground">{ai ? "Not rated by crews yet" : "No ratings yet"}</span>}
          </div>
          {(spot.crewTip || spot.description) && (
            <p className="mt-1.5 flex gap-1.5 text-xs text-muted-foreground">{ai ? <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-violet-600" /> : <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />}<span className="line-clamp-2">{spot.crewTip || spot.description}</span></p>
          )}
          {spot.address && (
            <a href={`https://maps.apple.com/?q=${encodeURIComponent(spot.name + " " + spot.address)}`} onClick={went} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <MapPin className="h-3 w-3" />{spot.address}
            </a>
          )}
          <div className="mt-2"><DirectionsButton place={spot} visitHref={ai ? aiAddHref(spot as AiPick) : undefined} testId={`button-pick-directions-${spot.id}`} /></div>
        </div>
      </div>
      {ai && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px]">
          <a href={outLink} onClick={went} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" />{spot.website ? "Website" : "Maps"}</a>
          <Link href={aiAddHref(spot as AiPick)} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`link-ai-add-${-spot.id}`} title="+10 points if you're the first to add and rate it"><Plus className="h-3 w-3" />Been here? Add it, +10 pts</Link>
        </div>
      )}
      {!readOnly && (
        <div className="mt-2.5 flex items-center justify-end gap-1">
          <button onClick={onUp} disabled={busy || (first ?? n === 1)} className="h-7 px-2 rounded-full text-[11px] border border-border hover-elevate disabled:opacity-30 inline-flex items-center gap-0.5" aria-label="Move up" data-testid={`button-pick-up-${spot.id}`}><ChevronUp className="h-3 w-3" />Up</button>
          <button onClick={onDown} disabled={busy || (last ?? n === count)} className="h-7 px-2 rounded-full text-[11px] border border-border hover-elevate disabled:opacity-30 inline-flex items-center gap-0.5" aria-label="Move down" data-testid={`button-pick-down-${spot.id}`}><ChevronDown className="h-3 w-3" />Down</button>
          {!favorite && <button onClick={onRemove} disabled={busy} className="h-7 px-2 rounded-full text-[11px] border border-border hover-elevate disabled:opacity-30 inline-flex items-center gap-1" data-testid={`button-pick-remove-${spot.id}`}><X className="h-3 w-3" />Remove</button>}
        </div>
      )}
    </li>
  );
}

// ---------------- shared (read-only) ----------------
export function SharedBriefPage() {
  const [, params] = useRoute("/b/:token");
  const { data: brief, isLoading, isError, error } = useQuery<BriefFull>({ queryKey: ["/api/shared/briefings", params?.token], retry: false, refetchInterval: aiPolling });
  const trip = useTrip(); const w = sheetWords(trip);
  groupPins(trip);
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (isError || !brief) return <p className="text-sm text-muted-foreground">{errText(error) || "This briefing isn't available."} <Link href="/" className="text-primary underline">Go to Wheelsdown</Link></p>;
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Plane className="h-3.5 w-3.5" />{w("Crew trip briefing")}</p>
        <h1 className="text-xl font-semibold leading-tight" data-testid="text-brief-title">{brief.title || w("Trip briefing")}</h1>
        <p className="font-code text-sm font-bold tracking-wide">{routeText(brief)}</p>
      </header>
      <ExportBar brief={brief} />
      <BriefOverview brief={brief} />
      {brief.stops.map((st, i) => {
        const { pins, numbered } = stopPins(st);
        return (
          <section key={i} className="space-y-3" data-testid={`section-stop-${i}`}>
            <div className="flex items-center gap-2">
              <span className="font-code text-sm font-bold rounded-md taxi-sign px-1.5 py-0.5">{st.icao}</span>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold">{layoverText(st)}</span>
              <span className="text-xs text-muted-foreground truncate">{st.airport?.city}</span>
            </div>
            <MapCanvas pins={pins} />
            <AiNote stop={st} />
            <ol className="space-y-2">{numbered.map(({ n, spot }) => <PickRow key={spot.id} n={n} spot={spot} count={numbered.length} readOnly favorite={(st.favoriteIds || []).includes(spot.id)} />)}</ol>
            {numbered.length === 0 && st.aiStatus !== "pending" && <p className="text-sm text-muted-foreground">No picks for this stop.</p>}
            {st.sponsor && (
              <a href={st.sponsor.url || "#"} target="_blank" rel="noopener noreferrer sponsored" className="block rounded-xl bg-muted/60 px-3 py-2 text-xs hover-elevate">
                <span className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground mr-2">Sponsored</span>
                <span className="font-medium">{st.sponsor.advertiser}</span> · {st.sponsor.headline}
              </a>
            )}
          </section>
        );
      })}
      <Link href="/" className="block text-center text-xs text-muted-foreground hover:text-foreground">Built with Wheelsdown, the crew-sourced layover guide</Link>
    </div>
  );
}

const SLOT_WORD = (sl: { cat: string; meal?: string }) => (sl.meal ? sl.meal : sl.cat === "do" ? "something to do" : sl.cat === "stay" ? "a hotel" : "a place to eat");
const WORD_ORDER = ["breakfast", "lunch", "dinner", "a place to eat", "something to do", "a hotel"];
/** Explains AI picks on a stop, or says they're on the way. */
function AiNote({ stop, onAi, busy }: { stop: BriefStopFull; onAi?: (on: boolean) => void; busy?: boolean }) {
  const slots = stop.aiSlots || [];
  const w = Array.from(new Set(slots.map(SLOT_WORD))).sort((a, b) => WORD_ORDER.indexOf(a) - WORD_ORDER.indexOf(b));
  const want = w.length > 1 ? `${w.slice(0, -1).join(", ")} or ${w[w.length - 1]}` : w[0];
  if (stop.aiStatus === "offer") {
    if (!onAi) return null; // shared view: only the owner decides
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-border px-3 py-2.5" data-testid="box-ai-offer">
        <p className="min-w-0 flex-1 basis-56 text-xs"><span className="font-semibold">No crew picks yet for {want} at {stop.icao}.</span> <span className="text-muted-foreground">AI can suggest real places to fill the gap, clearly tagged.</span></p>
        <button type="button" onClick={() => onAi(true)} disabled={busy} data-testid="button-pick-ai"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-violet-600 px-3.5 text-xs font-semibold text-white hover-elevate disabled:opacity-60">
          <Sparkles className="h-3.5 w-3.5" />Pick with AI
        </button>
        <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <Link href={`/add/${stop.icao}`} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid="link-ai-offer-add"><Plus className="h-3 w-3" />Add a spot at {stop.icao}</Link>
          <Link href="/settings?s=ai" className="text-muted-foreground underline underline-offset-2" data-testid="link-ai-setting">Always fill gaps with AI? Choose Prefer AI</Link>
        </div>
      </div>
    );
  }
  if (stop.aiStatus === "failed" && onAi && !stop.aiPicks?.length) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-border px-3 py-2.5" data-testid="box-ai-failed">
        <p className="min-w-0 flex-1 basis-56 text-xs"><span className="font-semibold">AI couldn't find picks at {stop.icao} just now.</span> <span className="text-muted-foreground">Try again in a couple of minutes.</span></p>
        <button type="button" onClick={() => onAi(true)} disabled={busy} data-testid="button-ai-retry"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate disabled:opacity-60"><RefreshCw className="h-3.5 w-3.5" />Try again</button>
      </div>
    );
  }
  if (stop.aiStatus === "pending") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-violet-500/10 px-3 py-2 text-xs" data-testid="text-ai-pending">
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-violet-600" />
        <span>No crew has listed {want || "everything"} at {stop.icao} yet. Finding AI picks to fill the gap, usually under a minute.</span>
      </p>
    );
  }
  if (!stop.aiPicks?.length) return null;
  return (
    <p className="flex items-start gap-2 text-[11px] text-muted-foreground" data-testid="text-ai-note">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
      <span>AI picks fill in where no crew has listed a place yet. They aren't crew-rated, so check hours before you go. Been to one? Add it and it becomes a crew pick.
        {onAi && <> <button type="button" onClick={() => onAi(false)} disabled={busy} className="font-medium text-foreground underline underline-offset-2" data-testid="button-remove-ai">Remove AI picks</button></>}</span>
    </p>
  );
}

/** Number badge: solid in the category color for crew listings; white with a dashed ring for AI picks (same on the map and PDF). */
function NumBadge({ n, spot, className }: { n: number; spot: SpotWithStats; className?: string }) {
  const c = PIN_COLORS[spot.category as keyof typeof PIN_COLORS];
  return looksAi(spot)
    ? <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-dashed bg-background text-[11px] font-bold", className)} style={{ borderColor: c, color: c }} title={isAi(spot) ? "AI pick" : "AI added, no crew ratings yet"} data-testid={`badge-ai-${n}`}>{n}</span>
    : <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white", className)} style={{ background: c }} title="Crew pick" data-testid={`badge-crew-${n}`}>{n}</span>;
}
function PickLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-testid="text-pick-legend">
      <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full bg-muted-foreground/70" />Crew pick</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border-2 border-dashed border-muted-foreground/70" />AI pick</span>
    </p>
  );
}
/** Why AI put this place in the briefing. */
function ReasonChip({ spot }: { spot: AiPick }) {
  const r = aiReason(spot);
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", r.kind === "fill" ? "bg-muted text-muted-foreground" : "bg-violet-500/10 text-violet-800 dark:text-violet-200")} data-testid={`text-ai-reason-${-spot.id}`}>{r.text}</span>;
}

type MoreKind = "" | "eat" | "do" | "stay" | "local";
const MORE_KINDS: [MoreKind, string, typeof Utensils][] = [["", "All", Plus], ["eat", "Food", Utensils], ["do", "Things to do", Compass], ["stay", "Hotels", BedDouble], ["local", "Surprise me", Sparkles]];
type MoreSort = "best" | "near";
const miles = (s: SpotWithStats) => s.milesFromField ?? 99;
/**
 * Add places: one panel for everything. Choose what you're after, then crew listings come first (vetted and best rated
 * on top), then AI picks. Tap + to add either. Ask AI for more of the chosen type at the bottom.
 */
function AddPlaces({ stop, index, others, onAddCrew, onAddAi, busy, openReq, search, onSearch }: { stop: BriefStopFull; index: number; others: SpotWithStats[]; onAddCrew: (id: number) => void; onAddAi: (rowId: number) => void; busy: boolean;
  openReq?: { kind: MoreKind; n: number } | null; search?: AiSearch | null; onSearch?: (cat: string) => void }) {
  const trip = useTrip();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MoreKind>("");
  const boxRef = useRef<HTMLDivElement>(null);
  // "See N more" in a category box opens this on that type
  useEffect(() => {
    if (!openReq) return;
    setOpen(true); setKind(openReq.kind);
    setTimeout(() => boxRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  }, [openReq?.n]); // eslint-disable-line
  const [sub, setSub] = useState("");
  const [sort, setSort] = useState<MoreSort>("best");
  const [asMap, setAsMap] = useState(false); // List or Map (crew feedback #56)
  const { data: cfg } = useQuery<{ ai?: boolean }>({ queryKey: ["/api/config"] });
  useEffect(() => setSub(""), [kind]);
  const focus = kind === "local" ? "local" : kind === "eat" ? sub || "eat" : kind === "do" ? (sub ? `act:${sub}` : "do") : kind;
  const more = stop.aiMore || [];
  const crewOf = (f: string) => (f === "local" ? [] : others.filter((c) => matchesFocus(c, f)));
  const crew = crewOf(focus).sort((a, b) => (sort === "near" ? miles(a) - miles(b) : pickScore(b) - pickScore(a) || miles(a) - miles(b)));
  const ai = more.filter((m) => matchesFocus(m, focus)).sort((a, b) => (sort === "near" ? miles(a) - miles(b) : 0));
  const pending = stop.aiMoreStatus === "pending";
  const subs = kind === "eat" ? CUISINES : kind === "do" ? ACTIVITIES : [];
  const fOf = (id: string) => (kind === "eat" ? id : `act:${id}`);
  const subList = subs.map((x) => ({ ...x, n: crewOf(fOf(x.id)).length + more.filter((m) => matchesFocus(m, fOf(x.id))).length })).sort((a, b) => Number(b.n > 0) - Number(a.n > 0));
  const kindCount = (k: MoreKind) => crewOf(k).length + more.filter((m) => matchesFocus(m, k)).length;
  const total = others.length + more.length;
  const aiOn = cfg?.ai !== false;
  // Tap a place to look at it first (crew feedback #44); only the + adds it to the briefing.
  const [peek, setPeek] = useState<number | null>(null);
  const row = (s: SpotWithStats, onClick: () => void, meta: string, badge?: React.ReactNode, testId?: string) => {
    const open = peek === s.id;
    const ai = isAi(s);
    const site = (s as any).website as string | undefined;
    return (
      <div key={s.id} className={cn(open && "bg-muted/40")}>
        <div className="flex items-center justify-between gap-2 pr-3">
          <button type="button" onClick={() => setPeek(open ? null : s.id)} aria-expanded={open} className="min-w-0 flex-1 px-3.5 py-2.5 text-left hover-elevate" data-testid={testId ? `${testId}-peek` : undefined}>
            <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{tag(s)}{s.name}</span>{badge}<ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} /></span>
            <span className={cn("block text-[11px] text-muted-foreground", open ? "whitespace-normal" : "truncate")}>{meta}</span>
          </button>
          <button type="button" onClick={onClick} disabled={busy} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-foreground hover-elevate disabled:opacity-50" aria-label={`Add ${s.name} to briefing`} data-testid={testId}><Plus className="h-4 w-4" /></button>
        </div>
        {open && (
          <div className="space-y-2 px-3.5 pb-3 text-xs" data-testid={testId ? `${testId}-preview` : undefined}>
            {s.description && !ai && <p className="text-muted-foreground">{s.description}</p>}
            {s.address && <p className="flex items-start gap-1 text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 shrink-0" />{s.address}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <DirectionsButton place={s} visitHref={ai ? aiAddHref(s as AiPick) : undefined} testId={testId ? `${testId}-directions` : undefined} />
              {site && <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" />Website</a>}
              {!ai && <Link href={`/spot/${s.id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">Crew ratings<ChevronRight className="h-3 w-3" /></Link>}
            </div>
            <button type="button" onClick={() => { onClick(); setPeek(null); }} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-full taxi-sign px-4 text-xs font-semibold hover-elevate disabled:opacity-50" data-testid={testId ? `${testId}-confirm` : undefined}><Plus className="h-3.5 w-3.5" />Add to briefing</button>
          </div>
        )}
      </div>
    );
  };
  // map numbers follow the list: crew listings first, then AI picks
  const listed = [...crew, ...ai];
  const numOf = new Map(listed.map((s, k) => [s.id, k + 1]));
  const morePins = [
    ...listed.filter((s) => s.lat != null && s.lng != null).map((s) => ({ lat: s.lat!, lng: s.lng!, label: String(numOf.get(s.id)), kind: s.category as "eat" | "do" | "stay" | "fbo", ai: isAi(s) })),
    ...(stop.airport?.lat != null && stop.airport?.lon != null ? [{ lat: stop.airport.lat, lng: stop.airport.lon, label: stop.icao, kind: "airport" as const }] : []),
  ];
  const tag = (s: SpotWithStats) => (asMap ? `${numOf.get(s.id)}. ` : "");
  const head = (Icon: typeof Users, label: string, n: number, tone: string, testId: string) => (
    <p className={cn("flex items-center gap-1.5 bg-muted/50 px-3.5 py-1.5 text-[11px] font-semibold", tone)} data-testid={testId}><Icon className="h-3.5 w-3.5" />{label}<span className="font-code opacity-70">{n}</span></p>
  );
  return (
    <div ref={boxRef} className="scroll-mt-20" data-testid={`section-pick-more-${index}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className={cn("inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border text-sm font-semibold hover-elevate", open ? "border-foreground/30 bg-muted" : "border-border")} data-testid={`button-pick-more-${index}`}>
        {open ? <><CheckCircle2 className="h-4 w-4" />Done adding</> : trip && total ? <><Plus className="h-4 w-4" />{total} more places at {stop.icao}</> : <><Plus className="h-4 w-4" />Add places at {stop.icao}{total ? <span className="ml-1 font-code text-xs text-muted-foreground">· {total}</span> : null}</>}
      </button>
      {open && (
        <div className="mt-2 rounded-2xl border border-card-border bg-card overflow-hidden">
          <div className="space-y-2 px-3 pt-3">
            <div className="flex items-center justify-between gap-2">
              {!trip && <p className="text-[11px] font-semibold text-muted-foreground">What are you looking for?</p>}
              {trip && (
                <div className="inline-flex rounded-full border border-border p-0.5" role="group" aria-label="List or map">
                  {([["list", "List"], ["map", "Map"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setAsMap(k === "map")} aria-pressed={asMap === (k === "map")} data-testid={`toggle-more-${k}-${index}`}
                      className={cn("h-6 rounded-full px-2.5 text-[11px] font-semibold", asMap === (k === "map") ? "bg-foreground text-background" : "text-muted-foreground")}>{l}</button>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as MoreSort)} className="h-7 rounded-full border border-border bg-background px-2 text-[11px] font-medium text-foreground" data-testid={`select-more-sort-${index}`}>
                  <option value="best">Crew-rated first</option><option value="near">Closest</option>
                </select>
              </label>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Kind of place">
              {MORE_KINDS.filter(([k]) => aiOn || k !== "local").map(([k, label, Icon]) => (
                <button key={k || "all"} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} data-testid={`chip-more-${k || "all"}-${index}`}
                  className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold", kind === k ? "border-foreground/40 bg-foreground text-background" : "border-border text-muted-foreground")}>
                  <Icon className="h-3.5 w-3.5" />{label}{k !== "local" && <span className="font-code opacity-70">{kindCount(k)}</span>}
                </button>
              ))}
            </div>
            {subs.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5" role="group" aria-label={kind === "eat" ? "Food type" : "Type of thing to do"}>
                <button type="button" onClick={() => setSub("")} aria-pressed={!sub} className={cn("h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium", !sub ? "border-foreground/40 bg-muted text-foreground" : "border-border text-muted-foreground")} data-testid={`chip-sub-any-${index}`}>Any</button>
                {subList.map((x) => (
                  <button key={x.id} type="button" onClick={() => setSub(sub === x.id ? "" : x.id)} aria-pressed={sub === x.id} data-testid={`chip-sub-${x.id}-${index}`}
                    className={cn("h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium", sub === x.id ? "border-foreground/40 bg-muted text-foreground" : "border-border text-muted-foreground", !x.n && sub !== x.id && "opacity-60")}>
                    {x.label}{x.n > 0 && <span className="ml-1 font-code opacity-70">{x.n}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {trip && asMap && (
            <div className="mt-2 px-3" data-testid={`map-more-${index}`}>
              {morePins.length > 1 ? <MapCanvas pins={morePins} height={220} /> : <p className="text-[11px] text-muted-foreground">None of these have a saved location to map yet.</p>}
              {listed.length > 0 && morePins.length - 1 < listed.length && <p className="mt-1 text-[11px] text-muted-foreground">{listed.length - (morePins.length - 1) === 1 ? "1 place has no saved location, so it's in the list only." : `${listed.length - (morePins.length - 1)} places have no saved location, so they're in the list only.`}</p>}
            </div>
          )}
          <div className="mt-2 border-t border-border">
            {crew.length > 0 && <>
              {head(Users, "Crew listings", crew.length, "text-emerald-700 dark:text-emerald-300", `head-more-crew-${index}`)}
              <div className="divide-y divide-border">
                {crew.map((s) => row(s, () => onAddCrew(s.id),
                  `${CAT_NAMES[s.category]} · ${s.milesFromField ? `${s.milesFromField} mi` : "On field"}${s.avgRating ? ` · ${s.avgRating.toFixed(1)}★ (${s.reviewCount})` : " · Not rated yet"}${s.cost != null ? ` · ${costText(s)}` : ""}`,
                  s.vet?.level === "vetted" ? <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Vetted</span> : null,
                  `button-add-candidate-${s.id}`))}
              </div>
            </>}
            {ai.length > 0 && <>
              {head(Sparkles, "AI picks", ai.length, "text-violet-700 dark:text-violet-300", `head-more-ai-${index}`)}
              <div className="divide-y divide-border">
                {ai.map((s) => {
                  const meal = (s as AiPick).ai.meal;
                  const r = aiReason(s as AiPick);
                  return row(s, () => onAddAi(-s.id),
                    `${CAT_NAMES[s.category]}${meal ? ` · ${MEAL_LABEL[meal]}` : ""}${s.milesFromField ? ` · ${s.milesFromField} mi` : ""}${s.cost != null ? ` · ${costText(s)}` : ""}${r.kind === "local" || r.kind === "asked" ? ` · ${r.text.replace(" · you asked", "")}` : ""}${s.description ? ` · ${s.description}` : ""}`,
                    <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">AI</span>,
                    `button-add-ai-${-s.id}`);
                })}
              </div>
            </>}
            {!crew.length && !ai.length && (
              <p className="px-3.5 py-3 text-xs text-muted-foreground" data-testid={`text-more-empty-${index}`}>
                {pending ? "Finding places, usually under a minute." : focus ? `Nothing else for ${focusLabel(focus).toLowerCase()} at ${stop.icao} yet.${aiOn ? " Ask AI below." : ""}` : `Everything listed at ${stop.icao} is already in the plan.${aiOn ? " Choose a type to ask AI for more." : ""}`}
              </p>
            )}
          </div>
          {aiOn && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
              <p className="min-w-0 flex-1 basis-40 text-[11px] text-muted-foreground">
                {pending ? "Finding more places, usually under a minute." : stop.aiMoreStatus === "failed" ? "AI didn't find anything new last time." : stop.aiMoreStatus === "full" ? `That's every place AI keeps for ${stop.icao}.` : focus ? `Want more ${focusLabel(focus).toLowerCase()}?` : "Choose Food, Things to do, Hotels or Surprise me to ask AI for more."}
              </p>
              {trip && search && search.cat === (focusCategory(focus) || "any") && <AiSearchLive stop={stop} search={search} label="places" busy={busy} onAiAdd={onAddAi} testId={`live-more-${index}`} />}
              {focus && stop.aiMoreStatus !== "full" && <FindMore icao={stop.icao} pending={pending} fixed={focus} onDone={() => onSearch?.(focusCategory(focus) || "any")} testId={`find-more-${index}`} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** End of the briefing: preview everything in one place, then share it, without scrolling back up. */
function FinalizeBar({ brief, preparedBy }: { brief: BriefFull; preparedBy?: string }) {
  const w = sheetWords(useTrip());
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [, navigate] = useLocation();
  useEffect(() => { if (!open) setShared(false); }, [open]);
  const total = brief.stops.reduce((n, s) => n + stopPins(s).numbered.length, 0);
  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4" data-testid="panel-finalize">
      <p className="text-sm font-semibold">Done planning?</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{brief.stops.length} stop{brief.stops.length > 1 ? "s" : ""} · {total} place{total === 1 ? "" : "s"}. Preview it, then send the PDF or a link to the crew.</p>
      <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-finalize">
        <Eye className="h-4 w-4" />{w("Finalize briefing")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto rounded-2xl p-0" data-testid="dialog-finalize">
          <div className="sticky top-0 z-10 border-b border-border bg-background px-5 pb-3 pt-5">
            <DialogTitle className="text-base font-semibold leading-snug">{brief.title || w("Trip briefing")}</DialogTitle>
            <DialogDescription className="font-code text-xs font-bold tracking-wide text-foreground">{routeText(brief)}</DialogDescription>
          </div>
          <div className="space-y-4 px-5 py-4">
            {brief.stops.map((st, i) => {
              const { numbered } = stopPins(st);
              return (
                <section key={i} data-testid={`preview-stop-${i}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-code text-xs font-bold rounded-md taxi-sign px-1.5 py-0.5">{st.icao}</span>
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold">{layoverText(st)}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{st.airport?.city}</span>
                  </div>
                  {numbered.length ? (
                    <ol className="mt-2 space-y-1.5">
                      {numbered.map(({ n, spot, ai }) => (
                        <li key={spot.id} className="flex items-center gap-2.5 text-sm">
                          <NumBadge n={n} spot={spot} />
                          <span className="min-w-0 flex-1 truncate">{spot.name}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{ai ? aiReason(spot as AiPick).text : CAT_NAMES[spot.category]}</span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="mt-1.5 text-xs text-muted-foreground">No picks for this stop.</p>}
                </section>
              );
            })}
            <PickLegend />
          </div>
          <div className="sticky bottom-0 border-t border-border bg-background p-3">
            {shared && <p className="mb-2 flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-200" data-testid="text-finalize-shared"><CheckCircle2 className="h-4 w-4 shrink-0" />Sent. It's saved under Briefings.</p>}
            <ExportBar brief={brief} preparedBy={preparedBy} onShared={() => setShared(true)} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-full border border-border text-xs font-semibold hover-elevate" data-testid="button-finalize-edit">Keep editing</button>
              <button type="button" onClick={() => { setOpen(false); navigate("/brief"); }} className={cn("h-10 rounded-full text-xs font-semibold hover-elevate", shared ? "bg-foreground text-background" : "border border-border")} data-testid="button-finalize-done">Done · All briefings</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
