import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import {
  ArrowLeft, ChevronRight, ClipboardList, FileDown, Link2, Loader2, MapPin, Plus, RefreshCw, Share2, Trash2, X, Plane, Lightbulb, Heart, Sparkles, Users, ExternalLink } from "lucide-react";
import { LAYOVERS, type LayoverId, type SpotWithStats } from "@shared/schema";
import { costRange, costText, paceLabel, paceOf } from "@shared/cost";
import { LAYOVER_PLAN, MEAL_LABEL } from "@shared/briefing";
import { apiRequest, queryClient, IS_STATIC } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { CAT_META, Chip, Stars, fmtMinutes, totalMinutes } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { drawStaticMap, PIN_COLORS } from "@/lib/staticMap";
import { buildBriefPdf, shareOrDownload, stopPins, layoverText, routeText, CAT_NAMES, isAi, type AiPick, type BriefFull, type BriefStopFull } from "@/lib/briefPdf";
import { errText } from "./add";
import { PickTag, FindMore, aiAddHref } from "@/lib/aiPicks";

type StopInput = { icao: string; layover: LayoverId; nights?: number; picks: number[]; ai?: boolean; aiAdd?: number[] };
type BriefSummary = { id: number; title: string; stops: { icao: string; layover: LayoverId }[]; updatedAt: number };
const parseCodes = (r: string) => r.toUpperCase().split(/[^A-Z0-9]+/).filter((c) => c.length === 3 || c.length === 4).slice(0, 12);
const appUrl = () => `${window.location.origin}${window.location.pathname}`;
const toInput = (b: BriefFull): StopInput[] => b.stops.map((s) => ({ icao: s.icao, layover: s.layover as LayoverId, nights: s.nights, picks: s.picks.map((p) => p.id), ...(s.ai != null ? { ai: s.ai } : {}), ...(s.aiAdd?.length ? { aiAdd: s.aiAdd } : {}) }));

/** Refetch every few seconds while AI picks are still being found for a stop (they take about a minute). */
const aiPolling = (q: { state: { data?: BriefFull } }) => (q.state.data?.stops.some((s) => s.aiStatus === "pending" || s.aiMoreStatus === "pending") ? 5000 : false);

// ---------------- delete (two taps, no browser pop-up) ----------------
function useDeleteBriefing(onDone?: () => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (bid: number) => (await apiRequest("DELETE", `/api/briefings/${bid}`)).json(),
    onSuccess: (_r, bid) => {
      queryClient.setQueryData<BriefSummary[]>(["/api/briefings"], (old) => old?.filter((b) => b.id !== bid));
      queryClient.removeQueries({ queryKey: ["/api/briefings", String(bid)] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"], exact: true });
      toast({ title: "Briefing deleted", description: "Its shared link no longer works." });
      onDone?.();
    },
    onError: (e: Error) => toast({ title: "Couldn't delete the briefing", description: errText(e), variant: "destructive" }),
  });
}

function DeleteBriefing({ id, onDone, compact }: { id: number; onDone?: () => void; compact?: boolean }) {
  const [ask, setAsk] = useState(false);
  const del = useDeleteBriefing(onDone);
  useEffect(() => { if (!ask) return; const t = setTimeout(() => setAsk(false), 6000); return () => clearTimeout(t); }, [ask]);
  if (compact && !ask) {
    return (
      <button type="button" onClick={() => setAsk(true)} aria-label="Delete briefing" data-testid={`button-brief-delete-${id}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover-elevate">
        <Trash2 className="h-4 w-4" />
      </button>
    );
  }
  if (!ask) {
    return (
      <button type="button" onClick={() => setAsk(true)} className="w-full h-10 rounded-full border border-border text-sm text-muted-foreground hover-elevate inline-flex items-center justify-center gap-1.5" data-testid="button-brief-delete">
        <Trash2 className="h-4 w-4" /> Delete briefing
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

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Trip briefings</h1>
        <p className="text-sm text-muted-foreground mt-1">Enter the routing and how long you're on the ground at each stop. Wheelsdown builds a layover plan from crew picks, with a map and a PDF for the PIC to send the crew.</p>
      </header>
      {!loading && !me ? (
        <div className="rounded-2xl border border-card-border bg-card p-5 text-center space-y-3" data-testid="panel-brief-signin">
          <ClipboardList className="mx-auto h-6 w-6 text-primary" />
          <p className="text-sm font-semibold">Sign in to build briefings</p>
          <p className="text-xs text-muted-foreground">Briefings are saved to your Logbook so you can update them and resend.</p>
          <button onClick={() => openAuth()} className="h-10 rounded-full taxi-sign px-5 text-sm font-semibold hover-elevate" data-testid="button-brief-signin">Sign in</button>
        </div>
      ) : (
        <>
          <Link href="/brief/new" data-testid="link-brief-new" className="flex items-center justify-between gap-3 rounded-2xl taxi-sign p-4 hover-elevate">
            <span className="flex items-center gap-3"><Plus className="h-5 w-5" /><span><span className="block text-sm font-semibold">New trip briefing</span><span className="block text-xs opacity-80">Routing, layovers, map, PDF</span></span></span>
            <ChevronRight className="h-5 w-5" />
          </Link>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Saved</h2>
            {isLoading && <Skeleton className="h-16 rounded-2xl" />}
            {data && data.length === 0 && <p className="text-sm text-muted-foreground">No briefings yet.</p>}
            {data?.map((b) => (
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
  const [layovers, setLayovers] = useState<Record<string, { layover: LayoverId; nights?: number }>>(
    Object.fromEntries((initial || []).map((s, i) => [`${i}:${s.icao}`, { layover: s.layover, nights: s.nights }])),
  );
  const codes = parseCodes(route);
  const keyOf = (i: number, c: string) => `${i}:${c}`;
  const get = (i: number, c: string) => layovers[keyOf(i, c)] || { layover: (i === codes.length - 1 && codes.length > 1 ? "overnight" : "hours") as LayoverId };
  const setL = (i: number, c: string, v: { layover: LayoverId; nights?: number }) => setLayovers({ ...layovers, [keyOf(i, c)]: v });
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
        return { icao: c, ...v, picks: same ? prevPicks.get(c) || [] : [], ...(was?.ai != null ? { ai: was.ai } : {}) };
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

// ---------------- editor ----------------
export function BriefEditorPage() {
  const [, paramsId] = useRoute("/brief/:id");
  const isNew = !paramsId || paramsId.id === "new";
  const id = isNew ? undefined : Number(paramsId!.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { me, requireAuth, loading } = useAuth();
  const [editRoute, setEditRoute] = useState(false);

  const { data: brief, isLoading } = useQuery<BriefFull>({ queryKey: ["/api/briefings", String(id)], enabled: !!me && !!id, refetchInterval: aiPolling });

  const save = useMutation({
    mutationFn: async (p: { title: string; stops: StopInput[]; suggest?: boolean }) => {
      let stops = p.stops;
      if (p.suggest) {
        const need = stops.filter((s) => !s.picks.length);
        if (need.length) {
          const sug = (await (await apiRequest("POST", "/api/briefings/suggest", { title: p.title, stops: need })).json()) as { stops: StopInput[] };
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
    onError: (e: Error) => toast({ title: "Couldn't save the briefing", description: errText(e), variant: "destructive" }),
  });


  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!me) return <BriefListPage />;

  if (isNew) {
    return (
      <div className="space-y-5">
        <Link href="/brief" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-briefs"><ArrowLeft className="h-4 w-4" /> Briefings</Link>
        <header>
          <h1 className="text-xl font-semibold">New trip briefing</h1>
          <p className="text-sm text-muted-foreground mt-1">We'll pick crew-rated spots that fit the time at each stop. You can swap anything before you send it.</p>
        </header>
        <RouteForm busy={save.isPending} submitLabel="Build briefing" onSubmit={(title, stops) => requireAuth(() => save.mutate({ title, stops, suggest: true }), "Sign in to build briefings.")} />
      </div>
    );
  }

  if (isLoading || !brief) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-64 rounded-2xl" /></div>;

  const input = toInput(brief);
  const update = (stops: StopInput[], suggest = false) => save.mutate({ title: brief.title, stops, suggest });

  return (
    <div className="space-y-5">
      <Link href="/brief" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-briefs"><ArrowLeft className="h-4 w-4" /> Briefings</Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold leading-tight" data-testid="text-brief-title">{brief.title || "Trip briefing"}</h1>
        <p className="font-code text-sm font-bold tracking-wide" data-testid="text-brief-route">{routeText(brief)}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <button onClick={() => setEditRoute(!editRoute)} className="text-primary font-medium" data-testid="button-brief-edit-route">{editRoute ? "Close" : "Change routing or layovers"}</button>
          {save.isPending && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Saving</span>}
        </div>
      </header>

      {editRoute && (
        <div className="rounded-2xl border border-primary/40 p-4">
          <RouteForm initial={input} initialTitle={brief.title} busy={save.isPending} submitLabel="Update briefing" onSubmit={(title, stops) => save.mutate({ title, stops, suggest: true })} />
        </div>
      )}

      <ExportBar brief={brief} preparedBy={me.displayName} />

      <BriefOverview brief={brief} />

      {brief.stops.map((st, i) => (
        <StopSection key={`${i}-${st.icao}`} stop={st} index={i}
          onRemovePick={(sid) => update(input.map((s, k) => (k === i ? { ...s, picks: s.picks.filter((p) => p !== sid) } : s)))}
          onAddPick={(sid) => update(input.map((s, k) => (k === i ? { ...s, picks: [...s.picks, sid] } : s)))}
          onMove={(sid, dir) => update(input.map((s, k) => {
            if (k !== i) return s;
            const a = [...s.picks]; const j = a.indexOf(sid); const t = j + dir;
            if (j < 0 || t < 0 || t >= a.length) return s;
            [a[j], a[t]] = [a[t], a[j]]; return { ...s, picks: a };
          }))}
          onResuggest={() => update(input.map((s, k) => (k === i ? { ...s, picks: [] } : s)), true)}
          onAi={(on) => update(input.map((s, k) => (k === i ? { ...s, ai: on, ...(on ? {} : { aiAdd: [] }) } : s)))}
          onAiAdd={(rowId) => update(input.map((s, k) => (k === i ? { ...s, ai: s.ai ?? true, aiAdd: Array.from(new Set([...(s.aiAdd || []), rowId])).slice(-20) } : s)))}
          onAiRemove={(rowId) => update(input.map((s, k) => (k === i ? { ...s, aiAdd: (s.aiAdd || []).filter((x) => x !== rowId) } : s)))}
          busy={save.isPending} />
      ))}

      <DeleteBriefing id={Number(id)} onDone={() => navigate("/brief")} />
    </div>
  );
}

// ---------------- export / share ----------------
function ExportBar({ brief, preparedBy }: { brief: BriefFull; preparedBy?: string }) {
  const { toast } = useToast();
  const [pdf, setPdf] = useState<{ blob: Blob; fileName: string; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fresh = pdf && pdf.key === brief.updatedAt;
  const shareUrl = `${appUrl()}#/b/${brief.shareToken}`;

  async function prepare() {
    setBusy(true);
    try {
      const out = await buildBriefPdf(brief, { appUrl: appUrl(), preparedBy });
      setPdf({ ...out, key: brief.updatedAt });
      // count one sponsor impression per stop that shows a sponsor line
      brief.stops.forEach((s) => s.sponsor && apiRequest("POST", `/api/ads/${s.sponsor.id}/impression`).catch(() => {}));
    } catch (e) {
      toast({ title: "Couldn't build the PDF", description: errText(e), variant: "destructive" });
    } finally { setBusy(false); }
  }
  async function send() {
    if (!pdf) return;
    const r = await shareOrDownload(pdf.blob, pdf.fileName, brief.title || "Trip briefing");
    if (r === "downloaded") toast({ title: "PDF downloaded", description: pdf.fileName });
  }
  async function copyLink() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      try { await nav.share({ url: shareUrl, title: brief.title || "Trip briefing" }); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(shareUrl); toast({ title: "Link copied", description: "Anyone with the link can view this briefing." }); }
    catch { toast({ title: "Share link", description: shareUrl }); }
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-3.5 space-y-2.5" data-testid="panel-brief-export">
      <div className="grid grid-cols-2 gap-2">
        {fresh ? (
          <button onClick={send} className="h-11 rounded-full taxi-sign text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover-elevate" data-testid="button-brief-share-pdf">
            <Share2 className="h-4 w-4" /> Share PDF
          </button>
        ) : (
          <button onClick={prepare} disabled={busy} className="h-11 rounded-full taxi-sign text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover-elevate disabled:opacity-60" data-testid="button-brief-pdf">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} {busy ? "Building PDF…" : "Prepare PDF"}
          </button>
        )}
        <button onClick={copyLink} className="h-11 rounded-full border border-border text-sm font-medium inline-flex items-center justify-center gap-1.5 hover-elevate" data-testid="button-brief-link">
          <Link2 className="h-4 w-4" /> Share link
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {fresh ? "Ready. On iPhone, Share PDF opens Messages, Mail and AirDrop." : "The PDF has a cover with the routing, then one page per stop with the map and picks."}
        {IS_STATIC ? " Demo: shared links only open in this browser." : ""}
      </p>
    </div>
  );
}

// ---------------- maps ----------------
function MapCanvas({ pins, height = 220, route, testId }: { pins: ReturnType<typeof stopPins>["pins"]; height?: number; route?: boolean; testId?: string }) {
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

function StopSection({ stop, index, onRemovePick, onAddPick, onMove, onResuggest, onAi, onAiAdd, onAiRemove, busy }: {
  stop: BriefStopFull; index: number; busy: boolean;
  onRemovePick: (id: number) => void; onAddPick: (id: number) => void; onMove: (id: number, dir: -1 | 1) => void; onResuggest: () => void; onAi: (on: boolean) => void;
  onAiAdd: (rowId: number) => void; onAiRemove: (rowId: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const { pins, numbered } = useMemo(() => stopPins(stop), [stop]);
  const picked = new Set(stop.picks.map((p) => p.id));
  const favs = new Set(stop.favoriteIds || []);
  const others = (stop.candidates || []).filter((c) => !picked.has(c.id));
  const plan = LAYOVER_PLAN[stop.layover as LayoverId];
  const unmapped = numbered.filter((n) => !n.mapped).length;

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
        <button onClick={onResuggest} disabled={busy} className="shrink-0 h-8 rounded-full border border-border px-2.5 text-xs inline-flex items-center gap-1 hover-elevate disabled:opacity-50" data-testid={`button-resuggest-${index}`}>
          <RefreshCw className="h-3.5 w-3.5" /> Re-pick
        </button>
      </div>
      {plan && <p className="text-[11px] text-muted-foreground">{plan.note}</p>}

      <MapCanvas pins={pins} testId={`map-stop-${index}`} />
      {unmapped > 0 && <p className="text-[11px] text-muted-foreground">{unmapped} pick{unmapped > 1 ? "s aren't" : " isn't"} on the map yet (no location saved). They're still in the list and the PDF.</p>}

      <AiNote stop={stop} onAi={onAi} busy={busy} />
      {numbered.length === 0 && stop.aiStatus !== "pending" && stop.aiStatus !== "offer" && (
        <div className="rounded-2xl border border-dashed border-border p-4 text-center">
          <p className="text-sm font-semibold">No crew picks at {stop.icao} yet</p>
          <Link href={`/add/${stop.icao}`} className="mt-2 inline-flex items-center gap-1.5 rounded-full taxi-sign px-3.5 py-1.5 text-xs font-semibold hover-elevate" data-testid={`link-add-at-${stop.icao}`}><Plus className="h-3.5 w-3.5" />Add a spot at {stop.icao}</Link>
        </div>
      )}

      <ol className="space-y-2">
        {numbered.map(({ n, spot, ai }) => <PickRow key={spot.id} n={n} spot={spot} count={stop.picks.length} readOnly={ai}
          favorite={favs.has(spot.id)} onRemove={() => onRemovePick(spot.id)} onUp={() => onMove(spot.id, -1)} onDown={() => onMove(spot.id, 1)} busy={busy}
          onRemoveAi={ai && (spot as AiPick).ai.extra ? () => onAiRemove(-spot.id) : undefined} />)}
      </ol>

      {((stop.aiPicks?.length || 0) > 0 || (stop.aiMore?.length || 0) > 0) && <PickMore stop={stop} index={index} onAdd={onAiAdd} busy={busy} />}

      {others.length > 0 && (
        <div>
          <button onClick={() => setAdding(!adding)} className="text-xs font-medium text-primary inline-flex items-center gap-1" data-testid={`button-add-pick-${index}`}>
            <Plus className="h-3.5 w-3.5" /> {adding ? "Done adding" : `Add from ${others.length} other ${stop.icao} listing${others.length > 1 ? "s" : ""}`}
          </button>
          {adding && (
            <div className="mt-2 rounded-2xl border border-card-border bg-card divide-y divide-border">
              {others.map((s) => (
                <button key={s.id} onClick={() => onAddPick(s.id)} disabled={busy} className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover-elevate disabled:opacity-50" data-testid={`button-add-candidate-${s.id}`}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{s.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{CAT_NAMES[s.category]} · {s.milesFromField ? `${s.milesFromField} mi` : "On field"}{s.avgRating ? ` · ${s.avgRating.toFixed(1)}★` : ""}</span>
                  </span>
                  <Plus className="h-4 w-4 text-primary shrink-0" />
                </button>
              ))}
            </div>
          )}
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

function PickRow({ n, spot, count, onRemove, onUp, onDown, busy, readOnly, favorite, onRemoveAi }: {
  onRemoveAi?: () => void;
  n: number; spot: SpotWithStats; count: number; onRemove?: () => void; onUp?: () => void; onDown?: () => void; busy?: boolean; readOnly?: boolean; favorite?: boolean;
}) {
  const M = CAT_META[spot.category as keyof typeof CAT_META];
  const ai = isAi(spot);
  const meal = ai ? (spot as AiPick).ai.meal : null;
  const extra = spot.category === "eat" ? (ai && !spot.pace ? "" : paceLabel(paceOf(spot))) : spot.category === "do" ? fmtMinutes(totalMinutes(spot)) : "";
  const outLink = spot.website || `https://maps.apple.com/?q=${encodeURIComponent(spot.name + " " + (spot.address || ""))}`;
  return (
    <li className={cn("rounded-2xl border bg-card p-3.5", ai ? "border-dashed border-violet-400/60" : "border-card-border")} data-testid={ai ? `pick-ai-${-spot.id}` : `pick-${spot.id}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: PIN_COLORS[spot.category as keyof typeof PIN_COLORS] }}>{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {ai ? <a href={outLink} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold leading-snug hover:underline underline-offset-2">{spot.name}</a>
              : <Link href={`/spot/${spot.id}`} className="text-sm font-semibold leading-snug hover:underline underline-offset-2">{spot.name}</Link>}
            {spot.category !== "fbo" && (!ai || spot.cost != null) && <span className="shrink-0 text-right"><span className="block font-code text-xs font-bold text-primary">{costText(spot)}</span>{spot.cost != null && spot.cost > 0 && <span className="block text-[10px] text-muted-foreground whitespace-nowrap">{costRange(spot.category, spot.cost)}</span>}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PickTag ai={ai} />
            {meal && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold" data-testid={`text-meal-${-spot.id}`}>{MEAL_LABEL[meal]}</span>}
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
            <a href={`https://maps.apple.com/?q=${encodeURIComponent(spot.name + " " + spot.address)}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <MapPin className="h-3 w-3" />{spot.address}
            </a>
          )}
        </div>
      </div>
      {ai && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px]">
          <a href={outLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" />{spot.website ? "Website" : "Maps"}</a>
          <Link href={aiAddHref(spot as AiPick)} className="inline-flex items-center gap-1 font-semibold text-primary" data-testid={`link-ai-add-${-spot.id}`} title="+10 points if you're the first to add and rate it"><Plus className="h-3 w-3" />Been here? Add it, +10 pts</Link>
          {onRemoveAi && <button type="button" onClick={onRemoveAi} disabled={busy} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50" data-testid={`button-remove-ai-${-spot.id}`}><X className="h-3 w-3" />Remove</button>}
        </div>
      )}
      {!readOnly && (
        <div className="mt-2.5 flex items-center justify-end gap-1">
          <button onClick={onUp} disabled={busy || n === 1} className="h-7 px-2 rounded-full text-[11px] border border-border hover-elevate disabled:opacity-30" aria-label="Move up" data-testid={`button-pick-up-${spot.id}`}>Up</button>
          <button onClick={onDown} disabled={busy || n === count} className="h-7 px-2 rounded-full text-[11px] border border-border hover-elevate disabled:opacity-30" aria-label="Move down" data-testid={`button-pick-down-${spot.id}`}>Down</button>
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
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (isError || !brief) return <p className="text-sm text-muted-foreground">{errText(error) || "This briefing isn't available."} <Link href="/" className="text-primary underline">Go to Wheelsdown</Link></p>;
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Plane className="h-3.5 w-3.5" />Crew trip briefing</p>
        <h1 className="text-xl font-semibold leading-tight" data-testid="text-brief-title">{brief.title || "Trip briefing"}</h1>
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
          <Link href="/me?s=ai" className="text-muted-foreground underline underline-offset-2" data-testid="link-ai-setting">Always fill gaps with AI? Choose Prefer AI</Link>
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

const MORE_CATS = [["all", "All"], ["eat", "Eat"], ["do", "Do"], ["stay", "Stay"]] as const;
/** "Pick more with AI": add other AI picks found for this airport, or ask AI for more places. */
function PickMore({ stop, index, onAdd, busy }: { stop: BriefStopFull; index: number; onAdd: (rowId: number) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<(typeof MORE_CATS)[number][0]>("all");
  const more = stop.aiMore || [];
  const list = cat === "all" ? more : more.filter((m) => m.category === cat);
  const pending = stop.aiMoreStatus === "pending";
  const counts = Object.fromEntries(MORE_CATS.map(([c]) => [c, c === "all" ? more.length : more.filter((m) => m.category === c).length]));
  return (
    <div data-testid={`section-pick-more-${index}`}>
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300" data-testid={`button-pick-more-${index}`}>
        <Sparkles className="h-3.5 w-3.5" /> {open ? "Done picking" : more.length ? `Pick more with AI · ${more.length} more at ${stop.icao}` : "Pick more with AI"}
      </button>
      {open && (
        <div className="mt-2 rounded-2xl border border-dashed border-violet-400/60 bg-card">
          {more.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-3 pt-3">
              {MORE_CATS.map(([c, label]) => counts[c] > 0 || c === "all" ? (
                <button key={c} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} data-testid={`chip-more-${c}-${index}`}
                  className={cn("h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-semibold", cat === c ? "border-violet-500 bg-violet-500/15 text-violet-800 dark:text-violet-200" : "border-border text-muted-foreground")}>
                  {label} <span className="font-code opacity-70">{counts[c]}</span>
                </button>
              ) : null)}
            </div>
          )}
          <div className="divide-y divide-border">
            {list.map((s) => {
              const meal = (s as AiPick).ai.meal;
              return (
                <button key={s.id} type="button" onClick={() => onAdd(-s.id)} disabled={busy} className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover-elevate disabled:opacity-50" data-testid={`button-add-ai-${-s.id}`}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{s.name}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">{CAT_NAMES[s.category]}{meal ? ` · ${MEAL_LABEL[meal]}` : ""}{s.milesFromField ? ` · ${s.milesFromField} mi` : ""}{s.cost != null ? ` · ${costText(s)}` : ""}{s.description ? ` · ${s.description}` : ""}</span>
                  </span>
                  <Plus className="h-4 w-4 text-violet-600 shrink-0" />
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {pending ? "Finding more places, usually under a minute." : stop.aiMoreStatus === "failed" ? "AI didn't find anything new last time." : stop.aiMoreStatus === "full" ? `That's every place AI keeps for ${stop.icao}.` : more.length ? "Want different options?" : `No other AI picks at ${stop.icao} yet.`}
            </p>
            {stop.aiMoreStatus !== "full" && <FindMore icao={stop.icao} pending={pending} testId={`find-more-${index}`} />}
          </div>
        </div>
      )}
    </div>
  );
}
