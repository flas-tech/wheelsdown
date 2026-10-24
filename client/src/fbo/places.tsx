import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Upload, Star, Search, Download, FileSpreadsheet, ArrowLeft, Sparkles, MapPin, ChevronDown, ChevronUp, Pencil, EyeOff, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FBO_CATEGORIES, FBO_CAT_LABEL, FBO_LIMITS, mapImport, parseDelimited, nameKey, type FboCategory, type FboSpot, type FboImportRow } from "@shared/fbo";
import { api, get, fboQuery, ApiError } from "./api";
import { Card, Empty, Field, PageHeader, Spinner, areaCls, btn, btnGhost, btnPrimary, inputCls, Counter } from "./ui";

/**
 * Recommendations = check marks on the shared Wheelsdown listings at your airport. One listing per business; the FBO's
 * note, crew rate and discount attach to it. A place that isn't listed yet is added once (with AI lookup) and checked.
 */
export type SpotsResp = { icao: string; airport: string; lat: number | null; lng: number | null; verified: boolean; aiEnabled: boolean; spots: FboSpot[] };
const TABS: { id: FboCategory; label: string }[] = [{ id: "eat", label: "Restaurants" }, { id: "stay", label: "Hotels" }, { id: "do", label: "Things to do" }];
export const refreshSpots = () => { for (const k of ["/api/fbo/spots", "/api/fbo/places", "/api/fbo/stats"]) fboQuery.invalidateQueries({ queryKey: [k] }); };
const stars = (s: FboSpot) => (s.crew.ratings ? `${(s.crew.avg ?? 0).toFixed(1)}★ · ${s.crew.ratings} crew rating${s.crew.ratings === 1 ? "" : "s"}` : "No crew ratings yet");
const addedLabel = { you: "Added by you", crew: "Added by crews", fbo: "Added by an FBO" } as const;

export function PlacesPage() {
  const { data, isLoading } = useQuery<SpotsResp>({ queryKey: ["/api/fbo/spots"], queryFn: get("/api/fbo/spots") });
  const [tab, setTab] = useState<FboCategory>("eat");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ name?: string; spot?: FboSpot } | null>(null);
  const [importing, setImporting] = useState(false);
  const { toast } = useToast();
  const spots = data?.spots || [];
  const check = useMutation({
    mutationFn: (s: FboSpot) => (s.rec ? api("DELETE", `/api/fbo/recs/${s.rec.id}`) : api("POST", "/api/fbo/recs", { spotId: s.spotId })),
    onSuccess: (_r, s) => { refreshSpots(); if (!s.rec) setOpen(s.spotId); toast({ title: s.rec ? `Removed ${s.name} from your picks` : data?.verified ? `${s.name} is on your crew page` : `${s.name} is checked`, description: !s.rec && !data?.verified ? "Your crew page goes live when you confirm your email." : undefined }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const list = useMemo(() => spots.filter((s) => s.category === tab && (!only || s.rec) && (!q || `${s.name} ${s.address}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(!!b.rec) - Number(!!a.rec) || Number(!!b.rec?.favorite) - Number(!!a.rec?.favorite) || b.crew.ratings - a.crew.ratings || a.name.localeCompare(b.name)), [spots, tab, only, q]);
  const counts = (c: FboCategory) => { const all = spots.filter((s) => s.category === c); return { all: all.length, mine: all.filter((s) => s.rec).length }; };
  const picks = spots.filter((s) => s.rec).length;
  const noMatch = q.trim().length >= 2 && !spots.some((s) => s.category === tab && nameKey(s.name) === nameKey(q));

  return (
    <>
      <PageHeader title="Recommendations"
        sub={<>Check the places your desk sends crews to. This is the same list crews use on Wheelsdown at {data?.icao || "your airport"}, so each place exists once and shows crew ratings next to your note. Not listed? Add it.</>}
        actions={<><button className={btn} onClick={() => setImporting(true)} data-testid="button-import"><Upload className="h-4 w-4" />Bulk upload</button><button className={btnPrimary} onClick={() => setAdding({})} data-testid="button-add-place"><Plus className="h-4 w-4" />Add a missing place</button></>} />
      {data && !data.verified && <div className="mb-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm" data-testid="banner-unverified">New places you add stay private until you confirm your email. Checking places that are already listed works right away.</div>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
          {TABS.map((t) => { const c = counts(t.id); return (
            <button key={t.id} onClick={() => { setTab(t.id); setOpen(null); }} className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover-elevate")} data-testid={`tab-cat-${t.id}`}>
              {t.label} <span className="tabular text-xs opacity-75">{c.mine}/{c.all}</span>
            </button>); })}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-only-mine" />Only my picks</label>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, "h-9 pl-8")} placeholder={`Search ${TABS.find((t) => t.id === tab)!.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-places" />
        </div>
      </div>

      {isLoading ? <Spinner /> : (
        <Card className="overflow-hidden p-0">
          <div className="max-h-[68vh] overflow-y-auto" data-testid="list-spots">
            {list.map((s) => (
              <SpotRow key={s.spotId} s={s} open={open === s.spotId} onToggleOpen={() => setOpen(open === s.spotId ? null : s.spotId)}
                onCheck={() => { if (s.rec && (s.rec.notes || s.rec.crewRate) && !confirm(`Remove ${s.name} from your picks? Your note and crew rate for it will be deleted.`)) return; check.mutate(s); }}
                onEditListing={() => setAdding({ spot: s })} busy={check.isPending && check.variables?.spotId === s.spotId} />
            ))}
            {!list.length && (
              <div className="p-6">
                <Empty title={q ? `No ${TABS.find((t) => t.id === tab)!.label.toLowerCase()} match "${q}"` : only ? "No picks here yet" : `No ${TABS.find((t) => t.id === tab)!.label.toLowerCase()} listed at ${data?.icao} yet`}>
                  {only ? "Uncheck \u201cOnly my picks\u201d to see everything crews have listed." : q ? "Add it with the button below and AI can fill in the details." : "Be the first: add the places your desk already recommends."}
                </Empty>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">{noMatch ? <>Don't see <b className="text-foreground">{q}</b>?</> : "Not on the list?"}</span>
            <button className={btn} onClick={() => setAdding({ name: noMatch ? q.trim() : "" })} data-testid="button-add-missing"><Sparkles className="h-4 w-4" />{noMatch ? `Add "${q.trim().slice(0, 30)}"` : "Add it"}{data?.aiEnabled ? " with AI lookup" : ""}</button>
          </div>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{picks} of {FBO_LIMITS.places} picks. Crew ratings come from Wheelsdown crews; your notes, crew rates and discounts are labeled as coming from your FBO.</p>
      {adding && data && <AddDialog ctx={data} cat={adding.spot?.category || tab} name={adding.name} edit={adding.spot} onClose={() => setAdding(null)} onRecommend={(id) => { const s = spots.find((x) => x.spotId === id); if (s) { setTab(s.category); setQ(""); if (!s.rec) check.mutate(s); else setOpen(id); } }} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function SpotRow({ s, open, onToggleOpen, onCheck, onEditListing, busy }: { s: FboSpot; open: boolean; onToggleOpen: () => void; onCheck: () => void; onEditListing: () => void; busy: boolean }) {
  const r = s.rec;
  return (
    <div className={cn("border-b border-border last:border-0", r && "bg-primary/[0.04]")} data-testid={`row-spot-${s.spotId}`}>
      <div className="flex items-start gap-3 px-3 py-3">
        <button role="checkbox" aria-checked={!!r} aria-label={r ? `Remove ${s.name} from your picks` : `Recommend ${s.name}`} onClick={onCheck} disabled={busy}
          className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border-2", r ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 hover-elevate")} data-testid={`check-spot-${s.spotId}`}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : r ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={r ? onToggleOpen : onCheck}>
          <p className="font-medium">{s.name}
            {r?.favorite && <Star className="ml-1.5 inline h-3.5 w-3.5 fill-primary text-primary" aria-label="FBO favorite" />}
            {r?.hidden && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Hidden</span>}
            {s.status === "pending" && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Waiting for email confirmation</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{[s.address || "No address yet", s.miles != null ? `${s.miles.toFixed(1)} mi from the field` : ""].filter(Boolean).join(" · ")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{stars(s)} · {addedLabel[s.addedBy]}{s.otherFbos ? ` · also recommended by ${s.otherFbos} other FBO${s.otherFbos === 1 ? "" : "s"}` : ""}</p>
          {r && !open && (r.crewRate || r.notes) && <p className="mt-1 truncate text-xs"><span className="font-medium">Your note:</span> {[r.crewRate, r.notes].filter(Boolean).join(" · ")}</p>}
        </button>
        {r && <button className={btnGhost} onClick={onToggleOpen} aria-label={open ? "Close details" : "Edit your note"} data-testid={`button-expand-${s.spotId}`}>{open ? <ChevronUp className="h-4 w-4" /> : <><Pencil className="h-3.5 w-3.5" /><span className="hidden sm:inline">Note</span></>}</button>}
      </div>
      {r && open && <RecEditor s={s} onEditListing={onEditListing} />}
    </div>
  );
}

function RecEditor({ s, onEditListing }: { s: FboSpot; onEditListing: () => void }) {
  const r = s.rec!;
  const [f, setF] = useState({ notes: r.notes || "", crewRate: r.crewRate || "", phone: r.phone || "", distance: r.distance || "", favorite: !!r.favorite, hidden: !!r.hidden });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const { toast } = useToast();
  const save = useMutation({ mutationFn: () => api("PATCH", `/api/fbo/recs/${r.id}`, f), onSuccess: () => { refreshSpots(); toast({ title: "Saved", description: "It's live on your crew page." }); }, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) });
  return (
    <form className="grid gap-3 border-t border-border/60 px-3 pb-4 pt-3 sm:grid-cols-2 sm:pl-12" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Why your desk recommends it" className="sm:col-span-2" hint={<Counter value={f.notes} max={FBO_LIMITS.notes} />}><textarea className={areaCls} rows={2} value={f.notes} onChange={set("notes")} maxLength={FBO_LIMITS.notes} placeholder="e.g. Best breakfast near the field, ask for the crew table" data-testid={`input-rec-notes-${s.spotId}`} /></Field>
      <Field label={s.category === "stay" ? "Crew rate" : "Price or crew perk"} hint={s.category === "stay" ? "e.g. Crew rate $139, shuttle included" : "e.g. Open late, delivers to the FBO"}><input className={inputCls} value={f.crewRate} onChange={set("crewRate")} maxLength={80} data-testid={`input-rec-rate-${s.spotId}`} /></Field>
      <Field label="Phone for crews"><input className={inputCls} value={f.phone} onChange={set("phone")} maxLength={40} inputMode="tel" /></Field>
      <Field label="Distance or drive time" hint="e.g. 5 min drive"><input className={inputCls} value={f.distance} onChange={set("distance")} maxLength={40} /></Field>
      <div className="flex flex-col justify-end gap-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.favorite} onChange={(e) => setF({ ...f, favorite: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid={`checkbox-rec-fav-${s.spotId}`} /><Star className="h-3.5 w-3.5" />Show in our favorites</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" /><EyeOff className="h-3.5 w-3.5" />Hide from my crew page for now</label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
        {s.canEdit ? <button type="button" className={btnGhost} onClick={onEditListing} data-testid={`button-edit-listing-${s.spotId}`}><Pencil className="h-3.5 w-3.5" />Edit the listing (name, address, website)</button>
          : <span className="text-xs text-muted-foreground">Crews keep this listing's details up to date.</span>}
        <button className={btnPrimary} disabled={save.isPending} data-testid={`button-save-rec-${s.spotId}`}>{save.isPending ? <Spinner /> : "Save note"}</button>
      </div>
    </form>
  );
}

type Hit = { ref: string; name: string; address: string; city: string; lat: number; lng: number; website?: string };
type Dup = { spotId: number; name: string; address?: string };

/** Add a place that isn't listed (or fix one this FBO added). Same steps crews use: find it on the map, let AI fill in the rest, review. */
function AddDialog({ ctx, cat, name, edit, onClose, onRecommend }: { ctx: SpotsResp; cat: FboCategory; name?: string; edit?: FboSpot; onClose: () => void; onRecommend: (spotId: number) => void }) {
  const [f, setF] = useState({ category: edit?.category || cat, name: edit?.name || name || "", address: edit?.address || "", website: edit?.website || "", description: edit?.description || "", crewTip: "",
    costLevel: (edit?.costLevel ?? null) as number | null, pace: (edit?.pace ?? null) as string | null, lat: null as number | null, lng: null as number | null, placeRef: null as string | null, tags: [] as string[],
    notes: "", crewRate: "", favorite: false });
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [dup, setDup] = useState<Dup | null>(null);
  const { toast } = useToast();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  // already on the list? (exact name match within this category)
  const local = useMemo(() => (edit ? null : (fboQuery.getQueryData<SpotsResp>(["/api/fbo/spots"])?.spots || []).find((s) => s.category === f.category && f.name.trim().length > 2 && nameKey(s.name) === nameKey(f.name))), [f.name, f.category, edit]);
  useEffect(() => {
    if (edit || f.name.trim().length < 3 || ctx.lat == null || f.placeRef) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { setHits((await api<Hit[]>("GET", `/api/places/search?q=${encodeURIComponent(f.name.trim())}&lat=${ctx.lat}&lng=${ctx.lng}&cat=${f.category}`)).slice(0, 6)); } catch { setHits([]); }
      setSearching(false);
    }, 450);
    return () => clearTimeout(t);
  }, [f.name, f.category, f.placeRef]);
  const ai = useMutation({
    mutationFn: () => api<any>("POST", "/api/fbo/autofill", { category: f.category, name: f.name, address: f.address, website: f.website, lat: f.lat, lng: f.lng, placeRef: f.placeRef }),
    onSuccess: (r) => {
      if (r.duplicate) setDup(r.duplicate);
      if (!r.found) { setAiNote("AI couldn't confirm this place. Check the name and add the address yourself."); return; }
      setF((p) => ({ ...p, name: r.name || p.name, address: p.address || r.address, website: p.website || r.website, description: r.description || p.description, crewTip: r.crewTip || p.crewTip,
        costLevel: r.costLevel ?? p.costLevel, pace: r.pace ?? p.pace, tags: r.tags || p.tags }));
      setAiNote(`Filled in by AI (${r.confidence} confidence). Check it before saving.`);
    },
    onError: (e: any) => { if (e instanceof ApiError && e.body?.duplicate) setDup(e.body.duplicate); toast({ title: e.message, variant: "destructive" }); },
  });
  const save = useMutation({
    mutationFn: (force: boolean) => edit
      ? api("PATCH", `/api/fbo/spots/${edit.spotId}`, { category: f.category, name: f.name, address: f.address, website: f.website, description: f.description, costLevel: f.costLevel, pace: f.pace })
      : api("POST", "/api/fbo/spots", { ...f, force, rec: { notes: f.notes, crewRate: f.crewRate, favorite: f.favorite } }),
    onSuccess: (r: any) => { refreshSpots(); toast({ title: edit ? "Listing updated" : `${f.name} added`, description: edit ? undefined : r?.status === "pending" ? "It goes live when you confirm your email." : "It's checked and on your crew page." }); onClose(); },
    onError: (e: any) => { if (e instanceof ApiError && e.status === 409 && e.body?.duplicate) { setDup(e.body.duplicate); return; } toast({ title: e.message, variant: "destructive" }); },
  });
  const pick = (h: Hit) => { setF({ ...f, name: h.name, address: [h.address, h.city].filter(Boolean).join(", "), website: f.website || h.website || "", lat: h.lat, lng: h.lng, placeRef: h.ref }); setHits([]); };
  const priceLabels = f.category === "do" ? ["Free", "$", "$$", "$$$", "$$$$"] : ["", "$", "$$", "$$$", "$$$$"];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{edit ? `Edit ${edit.name}` : "Add a place that isn't listed"}</DialogTitle>
          <DialogDescription>{edit ? "Only listings your FBO added can be edited here." : "It's added to Wheelsdown once, for every crew and FBO at the airport, and checked as your pick."}</DialogDescription>
        </DialogHeader>
        {(dup || local) && (
          <div className="rounded-lg border border-primary/50 bg-primary/10 p-3 text-sm" data-testid="box-duplicate">
            <p><b>{(dup || local)!.name}</b> is already on Wheelsdown at {ctx.icao}{(dup?.address || local?.address) ? ` (${dup?.address || local?.address})` : ""}. Recommend that listing instead so crews see one place with all its ratings.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={() => { onRecommend((dup || local)!.spotId); onClose(); }} data-testid="button-recommend-existing"><Check className="h-4 w-4" />Recommend the existing listing</button>
              {dup && <button className={btn} onClick={() => { setDup(null); save.mutate(true); }} data-testid="button-add-anyway">It's a different place, add mine</button>}
            </div>
          </div>
        )}
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(false); }}>
          <Field label="Type"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as FboCategory })} data-testid="select-place-category">{FBO_CATEGORIES.map((c) => <option key={c} value={c}>{FBO_CAT_LABEL[c]}</option>)}</select></Field>
          <Field label="Business name" className="relative">
            <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, placeRef: null })} maxLength={120} required autoFocus data-testid="input-place-name" />
            {(hits.length > 0 || searching) && !local && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                {searching && !hits.length ? <p className="px-3 py-2 text-xs text-muted-foreground">Looking on the map…</p> : hits.map((h) => (
                  <button type="button" key={h.ref} onClick={() => pick(h)} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover-elevate" data-testid={`hit-${h.ref}`}>
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span><span className="font-medium">{h.name}</span><span className="block text-xs text-muted-foreground">{[h.address, h.city].filter(Boolean).join(", ")}</span></span>
                  </button>))}
              </div>
            )}
          </Field>
          {!edit && ctx.aiEnabled && (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <button type="button" className={btn} disabled={f.name.trim().length < 2 || ai.isPending} onClick={() => { setAiNote(""); ai.mutate(); }} data-testid="button-ai-lookup">{ai.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />}{ai.isPending ? "Looking it up (up to a minute)…" : "AI look it up"}</button>
              <span className="text-xs text-muted-foreground">{aiNote || "Pick it from the map list first for the best match, then let AI fill in the details."}</span>
            </div>
          )}
          <Field label="Address" className="sm:col-span-2"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value, lat: null, lng: null })} maxLength={200} placeholder="Street, city" data-testid="input-place-address" /></Field>
          <Field label="Website"><input className={inputCls} value={f.website} onChange={set("website")} maxLength={400} placeholder="example.com" data-testid="input-place-website" /></Field>
          <Field label="Price"><select className={inputCls} value={f.costLevel ?? ""} onChange={(e) => setF({ ...f, costLevel: e.target.value === "" ? null : Number(e.target.value) })} data-testid="select-place-cost">
            <option value="">Not sure</option>{priceLabels.map((l, i) => l && <option key={i} value={i}>{l}</option>)}</select></Field>
          {f.category === "eat" && <Field label="Pace"><select className={inputCls} value={f.pace || "both"} onChange={(e) => setF({ ...f, pace: e.target.value })}><option value="grab">Grab and go</option><option value="sit">Sit down</option><option value="both">Either</option></select></Field>}
          <Field label="Short description" className="sm:col-span-2" hint="What crews see on the listing"><textarea className={areaCls} rows={2} value={f.description} onChange={set("description")} maxLength={400} data-testid="input-place-description" /></Field>
          {!edit && <>
            <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">Your recommendation</p>
            <Field label="Why your desk recommends it" className="sm:col-span-2" hint={<Counter value={f.notes} max={FBO_LIMITS.notes} />}><textarea className={areaCls} rows={2} value={f.notes} onChange={set("notes")} maxLength={FBO_LIMITS.notes} data-testid="input-place-notes" /></Field>
            <Field label={f.category === "stay" ? "Crew rate" : "Price or crew perk"}><input className={inputCls} value={f.crewRate} onChange={set("crewRate")} maxLength={80} data-testid="input-place-rate" /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.favorite} onChange={(e) => setF({ ...f, favorite: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-place-favorite" />Show in our favorites</label>
          </>}
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={f.name.trim().length < 2 || save.isPending || !!local} data-testid="button-save-place">{save.isPending ? <Spinner /> : edit ? "Save listing" : "Add and recommend"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TEMPLATE = `Name,Category,Address,Phone,Website,Notes,Crew rate,Distance,Favorite,Discount code,Discount details,Expires
Blue Ginger,Restaurant,5 Main St,555-0100,blueginger.example,Best sushi near the field,,5 min,yes,CREW10,10% off for crews,2026-12-31
Hilton Garden Inn,Hotel,100 Airport Rd,555-0111,hilton.com,Free shuttle on request,Crew rate $139,2 mi,yes,,,
`;

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [fallback, setFallback] = useState<FboCategory | "">("");
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [step, setStep] = useState<"input" | "preview" | "done">("input");
  const [result, setResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const parsed = useMemo(() => (text.trim() ? mapImport(parseDelimited(text), fallback || null) : null), [text, fallback]);
  const ok = (parsed?.rows.filter((r) => r.name && r.category) || []).slice(0, FBO_LIMITS.bulkRows);
  // the server matches each row against the listings already at the airport, so the preview shows exactly what will happen
  const [plan, setPlan] = useState<{ row: number; action: string; name: string; match?: string; message?: string }[] | null>(null);
  const preview = useMutation({
    mutationFn: (m: "skip" | "update") => api<any>("POST", "/api/fbo/recs/bulk", { mode: m, rows: ok, dryRun: true }),
    onSuccess: (r) => { setPlan(r.plan); setStep("preview"); }, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const run = useMutation({
    mutationFn: () => api("POST", "/api/fbo/recs/bulk", { mode, rows: ok }),
    onSuccess: (r) => { setResult(r); setStep("done"); refreshSpots(); fboQuery.invalidateQueries({ queryKey: ["/api/fbo/offers"] }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const ACTION: Record<string, string> = { new: "New listing", link: "Already listed: recommend it", update: "Your pick: update note", skip: "Your pick: skip", error: "Can't import" };
  const onFile = async (file?: File) => {
    if (!file) return;
    if (/\.(xlsx|xls|numbers)$/i.test(file.name)) { toast({ title: "Save it as CSV first", description: "In Excel or Numbers: File > Save As (or Export) > CSV. Or copy the cells and paste them here.", variant: "destructive" }); return; }
    setText(await file.text());
  };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" })); a.download = "wheelsdown-fbo-template.csv"; a.click(); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bulk upload recommendations</DialogTitle>
          <DialogDescription>Upload a CSV, or copy the rows straight out of Excel or Google Sheets and paste them below. The first row should be column names.</DialogDescription>
        </DialogHeader>
        {step === "input" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => fileRef.current?.click()} data-testid="button-choose-file"><FileSpreadsheet className="h-4 w-4" />Choose CSV file</button>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,.xlsx,.xls" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="input-file" />
              <button className={btn} onClick={download} data-testid="button-template"><Download className="h-4 w-4" />Download template</button>
            </div>
            <textarea className={cn(areaCls, "font-code text-xs")} rows={10} placeholder={"Name\tCategory\tAddress\tPhone\tWebsite\tNotes\nBlue Ginger\tRestaurant\t5 Main St\t555-0100\tblueginger.com\tBest sushi near the field"} value={text} onChange={(e) => setText(e.target.value)} data-testid="input-import-text" />
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Columns we recognize: <b>Name</b>, <b>Category</b> (restaurant, hotel, thing to do), Address, Phone, Website, Notes, Crew rate, Distance, Favorite (yes/no), Discount code, Discount details, Expires. Other columns are ignored. Up to {FBO_LIMITS.bulkRows} rows at a time.
            </div>
            {parsed && <p className="text-sm" data-testid="text-import-detected">Found {parsed.rows.length} rows. Matched columns: {Object.values(parsed.matched).join(", ") || "none"}{parsed.unknown.length ? <span className="text-muted-foreground"> · ignored: {parsed.unknown.join(", ")}</span> : null}</p>}
            {parsed && !parsed.matched.category && (
              <Field label="No category column found. Import every row as:"><select className={cn(inputCls, "w-56")} value={fallback} onChange={(e) => setFallback(e.target.value as any)} data-testid="select-import-fallback"><option value="">Choose…</option>{FBO_CATEGORIES.map((c) => <option key={c} value={c}>{FBO_CAT_LABEL[c]}s</option>)}</select></Field>
            )}
            {parsed && !parsed.matched.name && <p className="text-sm text-destructive">We need a column called Name (or Business, Restaurant, Hotel).</p>}
            <div className="flex justify-end gap-2"><button className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={!parsed?.rows.length || !parsed.matched.name} onClick={() => preview.mutate(mode)} data-testid="button-preview">{preview.isPending ? <Spinner /> : "Preview"}</button></div>
          </div>
        )}
        {step === "preview" && parsed && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span><b>{plan?.filter((p) => p.action === "new").length ?? 0}</b> new, <b>{plan?.filter((p) => p.action === "link").length ?? 0}</b> already on Wheelsdown{parsed.rows.length - ok.length ? `, ${parsed.rows.length - ok.length} need a name or type (left out)` : ""}</span>
              <label className="ml-auto flex items-center gap-2">If it's already one of your picks
                <select className={cn(inputCls, "h-8 w-auto")} value={mode} onChange={(e) => { const m = e.target.value as "skip" | "update"; setMode(m); preview.mutate(m); }} data-testid="select-import-mode"><option value="skip">skip it</option><option value="update">update my note</option></select>
              </label>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left"><tr>{["", "Name", "Type", "Address", "Crew rate", "Fav", "Discount"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {ok.map((r, i) => {
                    const p = plan?.[i]; const s = p ? (ACTION[p.action] + (p.match && p.match !== r.name ? ` (${p.match})` : "") + (p.message ? `: ${p.message}` : "")) : "…";
                    return (
                      <tr key={i} className="border-t border-border">
                        <td className="whitespace-nowrap px-2 py-1.5"><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", p?.action === "new" ? "bg-primary/20" : p?.action === "error" ? "bg-destructive/15 text-destructive" : "bg-muted")}>{s}</span></td>
                        <td className="px-2 py-1.5 font-medium">{r.name}</td><td className="px-2 py-1.5">{r.category ? FBO_CAT_LABEL[r.category] : "—"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{r.address}</td><td className="px-2 py-1.5">{r.crewRate}</td><td className="px-2 py-1.5">{r.favorite ? "★" : ""}</td>
                        <td className="px-2 py-1.5">{[r.code, r.offer].filter(Boolean).join(" · ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {parsed.rows.length > FBO_LIMITS.bulkRows && <p className="text-sm text-destructive">Only the first {FBO_LIMITS.bulkRows} rows will be imported. Upload the rest in a second batch.</p>}
            <div className="flex justify-between gap-2"><button className={btn} onClick={() => setStep("input")}><ArrowLeft className="h-4 w-4" />Back</button><button className={btnPrimary} disabled={!ok.length || run.isPending} onClick={() => run.mutate()} data-testid="button-run-import">{run.isPending ? <Spinner /> : `Import ${ok.length}`}</button></div>
          </div>
        )}
        {step === "done" && result && (
          <div className="space-y-3">
            <p className="text-sm" data-testid="text-import-result"><b>{result.added}</b> new listings added, <b>{result.linked}</b> existing listings recommended, <b>{result.updated}</b> notes updated, <b>{result.skipped}</b> skipped{result.offers ? <>, <b>{result.offers}</b> discounts created</> : null}. They're checked on your list and live on your crew page.</p>
            {result.errors?.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive">{result.errors.slice(0, 20).map((e: any) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>}
            <div className="flex justify-end"><button className={btnPrimary} onClick={onClose}>Done</button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


