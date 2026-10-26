/**
 * Trip-sheet-style place search for the FBO portal: the same "Don't like what you see? Ask AI" box crews get in a
 * trip sheet, locked to the airport the FBO signed up with. AI finds open (tap to preview) before the FBO lists them.
 * Behind fbo_ai_search (pilot FBOs until opened to all).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Loader2, MapPin, Navigation, Sparkles, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CUISINES } from "@shared/cuisine";
import { ACTIVITIES } from "@shared/activities";
import { focusLabel } from "@shared/focus";
import { FBO_LEVEL_LABEL, type FboAiFind, type FboAiResp, type FboCategory, type FboLevel } from "@shared/fbo";
import { api, get, fboQuery } from "./api";

const PRICE = ["Free", "$", "$$", "$$$", "$$$$"];
const NOUN: Record<FboCategory, string> = { eat: "restaurants", stay: "hotels", do: "things to do" };

/** The type drop-down crews get in Search and Ask AI: food type for restaurants, activity for things to do. */
export function TypeSelect({ cat, value, onChange, testId, any = true, surprise = false, icao, className }: {
  cat: FboCategory; value: string; onChange: (v: string) => void; testId: string; any?: boolean; surprise?: boolean; icao?: string; className?: string;
}) {
  if (cat === "stay") return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={cat === "eat" ? "Food type" : "Type of thing to do"} data-testid={testId}
      className={cn("h-9 rounded-lg border border-input bg-background px-2.5 text-sm", className)}>
      {any && <option value="">{cat === "eat" ? "Any food" : "Any things to do"}</option>}
      {surprise && <option value="local">Surprise me: what {icao || "the area"} is known for</option>}
      {cat === "eat"
        ? <optgroup label="Food type">{CUISINES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
        : <optgroup label="Things to do">{ACTIVITIES.map((a) => <option key={a.id} value={`act:${a.id}`}>{a.label}</option>)}</optgroup>}
    </select>
  );
}

const mapHref = (m: { name: string; address: string; lat: number | null; lng: number | null }) =>
  m.lat != null && m.lng != null ? `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.name} ${m.address}`)}`;

/** One AI find: tap the name for the details (like the trip sheet), then List only or List and recommend. */
function FindRow({ m, fresh, busy, onLevel }: { m: FboAiFind; fresh?: boolean; busy: boolean; onLevel: (l: FboLevel) => void }) {
  const [open, setOpen] = useState(false);
  const meta = [m.miles != null ? `${m.miles} mi` : "", m.costLevel != null ? PRICE[m.costLevel] || "" : ""].filter(Boolean).join(" · ");
  return (
    <div className={cn("rounded-lg", fresh && "wd-pop", open && "bg-muted/50")} data-testid={`ai-find-${m.id}`}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-left hover-elevate" data-testid={`ai-find-peek-${m.id}`}>
          <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{m.name}</span>
            {fresh && <span className="shrink-0 rounded-full bg-violet-600 px-1.5 text-[9px] font-bold uppercase tracking-wide text-white">{m.draft ? "Checking" : "New"}</span>}
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} /></span>
          <span className={cn("block text-xs text-muted-foreground", open ? "whitespace-normal" : "truncate")}>{[meta, open ? "" : m.description].filter(Boolean).join(" · ")}</span>
        </button>
        {!open && (
          <button type="button" disabled={busy} onClick={() => setOpen(true)} className="hidden h-8 shrink-0 rounded-lg border border-border px-2.5 text-xs font-medium hover-elevate disabled:opacity-50 sm:inline-flex sm:items-center" data-testid={`ai-find-choose-${m.id}`}>Add…</button>
        )}
      </div>
      {open && (
        <div className="space-y-2.5 px-1.5 pb-2.5 pt-1 text-xs" data-testid={`ai-find-preview-${m.id}`}>
          {m.description && <p className="text-muted-foreground">{m.description}</p>}
          {m.address && <p className="flex items-start gap-1 text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 shrink-0" />{m.address}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <a href={mapHref(m)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"><Navigation className="h-3 w-3" />Map</a>
            {m.website && <a href={m.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" />Website</a>}
            <span className="text-[11px] text-muted-foreground">Found by AI. Check it before you put your name on it.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["listed", "recommended"] as FboLevel[]).map((l) => (
              <button key={l} type="button" disabled={busy} onClick={() => onLevel(l)} data-testid={`ai-find-${l}-${m.id}`}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold hover-elevate disabled:opacity-50", l === "recommended" ? "bg-sky-600 text-white" : "border border-border bg-card")}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{FBO_LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Live = { t0: number; seen: number[]; done: boolean; saw: boolean; focus: string };

/** The Ask AI box under each tab, like a trip sheet's Eat/Do/Stay box. */
export function AiSearchBox({ cat, icao, type, hasItems, onAdded }: { cat: FboCategory; icao: string; type: string; hasItems: boolean; onAdded: (spotId: number) => void }) {
  const { toast } = useToast();
  const [live, setLive] = useState<Live | null>(null);
  const [focus, setFocus] = useState(type);
  const [all, setAll] = useState(false);
  useEffect(() => { setFocus(type); }, [type, cat]);
  useEffect(() => { setLive(null); setAll(false); }, [cat]);
  const key = `/api/fbo/ai?cat=${cat}`;
  const { data, isLoading } = useQuery<FboAiResp>({
    queryKey: [key], queryFn: get(key),
    refetchInterval: (q) => ((live && !live.done) || q.state.data?.status === "pending" ? 3000 : false),
  });
  // a first AI run for this airport starts on its own: show it live like an Ask AI search
  useEffect(() => { if (data?.status === "pending" && !live) setLive({ t0: Date.now(), seen: data.finds.map((f) => f.id), done: false, saw: true, focus: "" }); }, [data?.status]);
  // done when the run we started has finished (or after 2.5 minutes)
  useEffect(() => {
    if (!live || live.done || !data) return;
    const running = data.more === "pending" || data.status === "pending";
    if (running && !live.saw) setLive({ ...live, saw: true });
    else if (!running && (live.saw || Date.now() - live.t0 > 9000)) setLive({ ...live, done: true });
    else if (Date.now() - live.t0 > 150_000) setLive({ ...live, done: true });
  }, [data, live]);
  const [, tick] = useState(0);
  useEffect(() => { if (!live || live.done) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [live?.done, live?.t0]);

  const refreshAi = () => fboQuery.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/fbo/ai") });
  const ask = useMutation({
    mutationFn: () => api<{ status: string }>("POST", "/api/fbo/ai/more", { focus: focus || cat }),
    onSuccess: (r) => {
      if (r.status === "full") toast({ title: `That's plenty for ${icao}`, description: "AI has already found as many places as we keep for one airport. Add one you know with Add a missing place." });
      else if (r.status === "busy") toast({ title: "AI is at today's limit", description: "Try again tomorrow, or add a place you know." });
      else if (r.status === "off") toast({ title: "AI search isn't switched on right now" });
      else setLive({ t0: Date.now(), seen: (data?.finds || []).map((f) => f.id), done: false, saw: false, focus: focus || cat });
      refreshAi();
    },
    onError: (e: Error) => toast({ title: "Couldn't ask AI", description: e.message, variant: "destructive" }),
  });
  const add = useMutation({
    mutationFn: ({ m, level }: { m: FboAiFind; level: FboLevel }) => api<{ spotId: number; status: string; existing?: boolean }>("POST", `/api/fbo/ai/${m.id}/add`, { level }),
    onSuccess: (r, { m, level }) => {
      for (const k of ["/api/fbo/spots", "/api/fbo/places", "/api/fbo/stats"]) fboQuery.invalidateQueries({ queryKey: [k] });
      refreshAi();
      toast({ title: r.existing ? `${m.name} was already listed, so it's checked` : `${m.name} added`, description: r.status === "pending" ? "It goes live when you confirm your email." : level === "listed" ? "It's listed on your crew page." : "It's recommended on your crew page." });
      onAdded(r.spotId);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  if (isLoading || !data || data.status === "off") return null;
  const label = NOUN[cat];
  const fresh = live ? data.finds.filter((f) => !live.seen.includes(f.id)) : [];
  const rest = data.finds.filter((f) => !fresh.some((x) => x.id === f.id)).filter((f) => !type || matches(f, type));
  const shown = all ? rest : rest.slice(0, live ? 0 : 4);
  const secs = live ? Math.round((Date.now() - live.t0) / 1000) : 0;
  const what = live?.focus === "local" ? `what ${icao} is known for` : live?.focus && live.focus !== cat ? focusLabel(live.focus).toLowerCase() : label;
  const step = !live ? "" : live.done ? (fresh.length ? `Found ${fresh.length} new ${fresh.length === 1 ? "place" : "places"}. Tap one to check it, then list it.` : "Nothing new this time. Try another type.")
    : !fresh.length ? (secs < 8 ? `Looking up ${what} on the map near ${icao}…` : `Still looking near ${icao}…`) : `Found ${fresh.length} so far. AI is checking hours and reviews…`;
  const busyRow = (m: FboAiFind) => add.isPending && add.variables?.m.id === m.id;
  return (
    <div className="m-3 space-y-2 rounded-xl border border-dashed border-violet-400/60 bg-card p-3" data-testid={`ai-box-${cat}`}>
      {live ? (
        <div className="space-y-1.5" aria-live="polite" data-testid="ai-live">
          <div className="flex items-center gap-2">
            {live.done ? <Sparkles className="h-4 w-4 shrink-0 text-violet-600" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />}
            <p className="min-w-0 flex-1 text-xs font-semibold text-violet-700 dark:text-violet-300" data-testid="ai-live-step">{step}</p>
            {!live.done && <span className="font-code text-[10px] text-muted-foreground">{secs}s</span>}
            {live.done && <button type="button" onClick={() => setLive(null)} aria-label="Close" className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover-elevate"><X className="h-3.5 w-3.5" /></button>}
          </div>
          {!live.done && <div className="h-1 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950"><div className="wd-scan h-full w-1/3 rounded-full bg-violet-500" /></div>}
          {fresh.map((m) => <FindRow key={m.id} m={m} fresh busy={busyRow(m)} onLevel={(level) => add.mutate({ m, level })} />)}
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold">{hasItems ? "Don't like what you see?" : "Nothing listed yet?"}</p>
          <p className="text-xs text-muted-foreground">{rest.length ? `AI found these near ${icao} that crews haven't listed. Tap one to check it, then list it.` : `Ask AI to find ${label} near ${icao}, the airport on your account.`}</p>
        </div>
      )}
      {shown.map((m) => <FindRow key={m.id} m={m} busy={busyRow(m)} onLevel={(level) => add.mutate({ m, level })} />)}
      {!live && rest.length > 4 && <button type="button" onClick={() => setAll(!all)} className="text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300" data-testid="button-ai-show-all">{all ? "Show fewer" : `Show all ${rest.length} AI finds`}</button>}
      {data.status === "none" && !rest.length && <p className="text-xs text-muted-foreground">AI is at today's limit. Try again tomorrow.</p>}
      {!(live && !live.done) && (data.more === "full" ? <p className="text-xs text-muted-foreground">AI has found all it keeps for {icao}.</p> : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <TypeSelect cat={cat} value={focus} onChange={setFocus} testId={`ai-focus-${cat}`} surprise icao={icao} className="h-9 min-w-0 flex-1 rounded-full text-xs font-semibold sm:flex-none" />
          <button type="button" onClick={() => ask.mutate()} disabled={ask.isPending || data.status === "pending" || data.more === "pending"} data-testid={`button-ask-ai-${cat}`}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-violet-600 px-3.5 text-xs font-semibold text-white hover-elevate disabled:opacity-60">
            {ask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {focus === "local" ? "Surprise me" : `Ask AI for more ${focus ? focusLabel(focus).toLowerCase() : label}`}
          </button>
        </div>
      ))}
    </div>
  );
}

function matches(f: FboAiFind, type: string) {
  if (type.startsWith("act:")) return f.acts.includes(type.slice(4)) || f.focus === type;
  return f.foods.includes(type) || f.focus === type;
}
