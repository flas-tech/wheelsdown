import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Upload, Star, Pencil, Trash2, Eye, EyeOff, Search, Download, FileSpreadsheet, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FBO_CATEGORIES, FBO_CAT_LABEL, FBO_LIMITS, mapImport, parseDelimited, nameKey, type FboCategory, type FboPlace, type FboImportRow } from "@shared/fbo";
import { api, get, fboQuery } from "./api";
import { Card, Empty, Field, PageHeader, Spinner, areaCls, btn, btnGhost, btnPrimary, inputCls, Counter } from "./ui";

const CAT_TABS: { id: "all" | FboCategory; label: string }[] = [{ id: "all", label: "All" }, { id: "eat", label: "Restaurants" }, { id: "stay", label: "Hotels" }, { id: "do", label: "Things to do" }];
const refresh = () => { fboQuery.invalidateQueries({ queryKey: ["/api/fbo/places"] }); fboQuery.invalidateQueries({ queryKey: ["/api/fbo/stats"] }); };

export function PlacesPage() {
  const { data: places, isLoading } = useQuery<FboPlace[]>({ queryKey: ["/api/fbo/places"], queryFn: get("/api/fbo/places") });
  const [tab, setTab] = useState<"all" | FboCategory>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<FboPlace> | null>(null);
  const [importing, setImporting] = useState(false);
  const { toast } = useToast();
  const patch = useMutation({
    mutationFn: ({ id, ...b }: Partial<FboPlace> & { id: number }) => api("PATCH", `/api/fbo/places/${id}`, b),
    onSuccess: refresh, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: (id: number) => api("DELETE", `/api/fbo/places/${id}`), onSuccess: () => { refresh(); toast({ title: "Removed" }); } });
  const list = useMemo(() => (places || []).filter((p) => (tab === "all" || p.category === tab) && (!q || `${p.name} ${p.address} ${p.notes}`.toLowerCase().includes(q.toLowerCase()))), [places, tab, q]);
  const count = (c: "all" | FboCategory) => (places || []).filter((p) => c === "all" || p.category === c).length;

  return (
    <>
      <PageHeader title="Recommendations" sub="The restaurants, hotels and things to do your desk recommends. Starred favorites show first on your crew page."
        actions={<><button className={btn} onClick={() => setImporting(true)} data-testid="button-import"><Upload className="h-4 w-4" />Bulk upload</button><button className={btnPrimary} onClick={() => setEditing({ category: tab === "all" ? "eat" : tab })} data-testid="button-add-place"><Plus className="h-4 w-4" />Add</button></>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
          {CAT_TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover-elevate")} data-testid={`tab-cat-${t.id}`}>
              {t.label} <span className="tabular text-xs opacity-70">{count(t.id)}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, "h-9 pl-8")} placeholder="Search your list" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-places" />
        </div>
      </div>

      {isLoading ? <Spinner /> : !places?.length ? (
        <Empty title="No recommendations yet">Add them one at a time, or upload the list you already hand crews (CSV, or paste from Excel or Google Sheets).
          <div className="mt-4 flex justify-center gap-2"><button className={btn} onClick={() => setImporting(true)}><Upload className="h-4 w-4" />Bulk upload</button><button className={btnPrimary} onClick={() => setEditing({ category: "eat" })}><Plus className="h-4 w-4" />Add one</button></div>
        </Empty>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="hidden border-b border-border bg-muted/40 text-left text-xs text-muted-foreground md:table-header-group">
              <tr><th className="w-10 px-3 py-2"></th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Crew rate / note</th><th className="w-36 px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={cn("border-b border-border last:border-0 align-top", p.hidden && "opacity-55")} data-testid={`row-place-${p.id}`}>
                  <td className="px-3 py-3">
                    <button aria-label={p.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => patch.mutate({ id: p.id, favorite: !p.favorite })} className="grid h-7 w-7 place-items-center rounded-full hover-elevate" data-testid={`button-fav-${p.id}`}>
                      <Star className={cn("h-4 w-4", p.favorite ? "fill-primary text-primary" : "text-muted-foreground")} />
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium">{p.name}{p.hidden && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Hidden</span>}</p>
                    <p className="text-xs text-muted-foreground">{[p.address, p.distance].filter(Boolean).join(" · ") || "No address"}</p>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">{FBO_CAT_LABEL[p.category]}{p.crewRate ? ` · ${p.crewRate}` : ""}</p>
                  </td>
                  <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{FBO_CAT_LABEL[p.category]}</td>
                  <td className="hidden max-w-xs px-3 py-3 md:table-cell"><p className="truncate">{p.crewRate || <span className="text-muted-foreground">{p.notes ? p.notes.slice(0, 70) : "—"}</span>}</p></td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button className={btnGhost} aria-label={p.hidden ? "Show on crew page" : "Hide from crew page"} onClick={() => patch.mutate({ id: p.id, hidden: !p.hidden })} data-testid={`button-hide-${p.id}`}>{p.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                    <button className={btnGhost} aria-label="Edit" onClick={() => setEditing(p)} data-testid={`button-edit-${p.id}`}><Pencil className="h-4 w-4" /></button>
                    <button className={btnGhost} aria-label="Delete" onClick={() => { if (confirm(`Remove ${p.name}?`)) del.mutate(p.id); }} data-testid={`button-delete-${p.id}`}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{places?.length || 0} of {FBO_LIMITS.places} during the beta. Hidden picks stay in your list but don't show to crews.</p>
      {editing && <PlaceDialog place={editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog existing={places || []} onClose={() => setImporting(false)} />}
    </>
  );
}

function PlaceDialog({ place, onClose }: { place: Partial<FboPlace>; onClose: () => void }) {
  const [f, setF] = useState({ category: place.category || "eat", name: place.name || "", address: place.address || "", phone: place.phone || "", website: place.website || "",
    notes: place.notes || "", crewRate: place.crewRate || "", distance: place.distance || "", favorite: !!place.favorite });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => (place.id ? api("PATCH", `/api/fbo/places/${place.id}`, f) : api("POST", "/api/fbo/places", f)),
    onSuccess: () => { refresh(); toast({ title: place.id ? "Saved" : "Added", description: "It's live on your crew page." }); onClose(); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{place.id ? "Edit recommendation" : "Add a recommendation"}</DialogTitle></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="Type"><select className={inputCls} value={f.category} onChange={set("category")} data-testid="select-place-category">{FBO_CATEGORIES.map((c) => <option key={c} value={c}>{FBO_CAT_LABEL[c]}</option>)}</select></Field>
          <Field label="Name"><input className={inputCls} value={f.name} onChange={set("name")} maxLength={FBO_LIMITS.name} required data-testid="input-place-name" autoFocus /></Field>
          <Field label="Address" className="sm:col-span-2"><input className={inputCls} value={f.address} onChange={set("address")} maxLength={FBO_LIMITS.short} placeholder="Street, city" data-testid="input-place-address" /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set("phone")} maxLength={40} inputMode="tel" data-testid="input-place-phone" /></Field>
          <Field label="Website"><input className={inputCls} value={f.website} onChange={set("website")} maxLength={400} placeholder="example.com" data-testid="input-place-website" /></Field>
          <Field label="Distance or drive time" hint="e.g. 5 min drive, 2 mi"><input className={inputCls} value={f.distance} onChange={set("distance")} maxLength={40} data-testid="input-place-distance" /></Field>
          <Field label={f.category === "stay" ? "Crew rate" : "Price or crew perk"} hint={f.category === "stay" ? "e.g. Crew rate $139, shuttle included" : "e.g. $$, open late"}><input className={inputCls} value={f.crewRate} onChange={set("crewRate")} maxLength={80} data-testid="input-place-rate" /></Field>
          <Field label="Why you recommend it" className="sm:col-span-2" hint={<Counter value={f.notes} max={FBO_LIMITS.notes} />}><textarea className={areaCls} rows={3} value={f.notes} onChange={set("notes")} maxLength={FBO_LIMITS.notes} data-testid="input-place-notes" /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.favorite} onChange={(e) => setF({ ...f, favorite: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-place-favorite" />Show in our favorites</label>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={!f.name || save.isPending} data-testid="button-save-place">{save.isPending ? <Spinner /> : "Save"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TEMPLATE = `Name,Category,Address,Phone,Website,Notes,Crew rate,Distance,Favorite,Discount code,Discount details,Expires
Blue Ginger,Restaurant,5 Main St,555-0100,blueginger.example,Best sushi near the field,,5 min,yes,CREW10,10% off for crews,2026-12-31
Hilton Garden Inn,Hotel,100 Airport Rd,555-0111,hilton.com,Free shuttle on request,Crew rate $139,2 mi,yes,,,
`;

function ImportDialog({ existing, onClose }: { existing: FboPlace[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [fallback, setFallback] = useState<FboCategory | "">("");
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [step, setStep] = useState<"input" | "preview" | "done">("input");
  const [result, setResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const parsed = useMemo(() => (text.trim() ? mapImport(parseDelimited(text), fallback || null) : null), [text, fallback]);
  const known = useMemo(() => new Set(existing.map((p) => `${p.category}|${nameKey(p.name)}`)), [existing]);
  const status = (r: FboImportRow) => (!r.name ? "No name" : !r.category ? "Type?" : known.has(`${r.category}|${nameKey(r.name)}`) ? (mode === "skip" ? "Already listed (skip)" : "Already listed (update)") : "New");
  const ok = parsed?.rows.filter((r) => r.name && r.category) || [];
  const run = useMutation({
    mutationFn: () => api("POST", "/api/fbo/places/bulk", { mode, rows: ok }),
    onSuccess: (r) => { setResult(r); setStep("done"); refresh(); fboQuery.invalidateQueries({ queryKey: ["/api/fbo/offers"] }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
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
            <div className="flex justify-end gap-2"><button className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={!parsed?.rows.length || !parsed.matched.name} onClick={() => setStep("preview")} data-testid="button-preview">Preview</button></div>
          </div>
        )}
        {step === "preview" && parsed && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span><b>{ok.length}</b> ready{parsed.rows.length - ok.length ? `, ${parsed.rows.length - ok.length} need fixing (skipped)` : ""}</span>
              <label className="ml-auto flex items-center gap-2">If a name is already on your list
                <select className={cn(inputCls, "h-8 w-auto")} value={mode} onChange={(e) => setMode(e.target.value as any)} data-testid="select-import-mode"><option value="skip">skip it</option><option value="update">update it</option></select>
              </label>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left"><tr>{["", "Name", "Type", "Address", "Crew rate", "Fav", "Discount"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {parsed.rows.slice(0, FBO_LIMITS.bulkRows).map((r, i) => {
                    const s = status(r);
                    return (
                      <tr key={i} className="border-t border-border">
                        <td className="whitespace-nowrap px-2 py-1.5"><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", s === "New" ? "bg-primary/20" : s.startsWith("Already") ? "bg-muted" : "bg-destructive/15 text-destructive")}>{s}</span></td>
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
            <div className="flex justify-between gap-2"><button className={btn} onClick={() => setStep("input")}><ArrowLeft className="h-4 w-4" />Back</button><button className={btnPrimary} disabled={!ok.length || run.isPending} onClick={() => run.mutate()} data-testid="button-run-import">{run.isPending ? <Spinner /> : `Import ${Math.min(ok.length, FBO_LIMITS.bulkRows)}`}</button></div>
          </div>
        )}
        {step === "done" && result && (
          <div className="space-y-3">
            <p className="text-sm" data-testid="text-import-result"><b>{result.added}</b> added, <b>{result.updated}</b> updated, <b>{result.skipped}</b> skipped{result.offers ? <>, <b>{result.offers}</b> discounts created</> : null}. They're live on your crew page now.</p>
            {result.errors?.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive">{result.errors.slice(0, 20).map((e: any) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>}
            <div className="flex justify-end"><button className={btnPrimary} onClick={onClose}>Done</button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


