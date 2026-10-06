import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Upload, Trash2, Eye, EyeOff, Plus, Lock, Pencil, LogOut } from "lucide-react";
import { CATEGORIES, DOWN_REASONS, type Ad, type SpotWithStats } from "@shared/schema";
import { apiRequest, queryClient, API_BASE, IS_STATIC } from "@/lib/queryClient";
import { CAT_META, COST_LABELS, VetBadge } from "@/lib/ui";
import { costText, paceOf } from "@shared/cost";
import { TierChip } from "@/lib/auth";
import type { PublicUser } from "@shared/tiers";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const inputCls = "w-full h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const btn = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-medium border border-border bg-card hover-elevate disabled:opacity-50";
const btnPrimary = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-semibold taxi-sign hover-elevate disabled:opacity-50";

let ADMIN_KEY = "";
const adm = (method: string, url: string, data?: unknown) => apiRequest(method, url, data, { "x-admin-key": ADMIN_KEY });
const admGet = <T,>(url: string) => async () => (await adm("GET", url)).json() as Promise<T>;

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  return <Console onLogout={() => { ADMIN_KEY = ""; setAuthed(false); }} />;
}

function Login({ onOk }: { onOk: () => void }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mx-auto max-w-sm space-y-4 rounded-2xl border border-card-border bg-card p-6 mt-8"
      onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr("");
        try { ADMIN_KEY = key; await adm("POST", "/api/admin/login"); onOk(); }
        catch { setErr("That key didn't work."); ADMIN_KEY = ""; }
        setBusy(false);
      }}
    >
      <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /><h1 className="text-base font-semibold">Admin console</h1></div>
      <p className="text-sm text-muted-foreground">Bulk edit spots, import/export CSV, and manage ad inventory.</p>
      {IS_STATIC && <p className="rounded-lg bg-primary/10 p-2.5 text-xs" data-testid="text-demo-key">Demo build — use key <span className="font-code font-bold">wheelsdown-admin</span>. Changes are saved only in this browser.</p>}
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Admin key" data-testid="input-admin-key" className={inputCls + " h-11"} autoFocus />
      {err && <p className="text-sm text-destructive" data-testid="text-admin-error">{err}</p>}
      <button disabled={!key || busy} data-testid="button-admin-login" className={btnPrimary + " w-full justify-center h-11"}>{busy ? "Checking…" : "Unlock"}</button>
    </form>
  );
}

function Console({ onLogout }: { onLogout: () => void }) {
  const { data: stats } = useQuery<Record<string, number>>({ queryKey: ["/api/admin/stats"], queryFn: admGet("/api/admin/stats") });
  const ctr = stats && stats.impressions ? ((stats.clicks / stats.impressions) * 100).toFixed(1) + "%" : "—";
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Admin console</h1>
        <button onClick={onLogout} className={btn} data-testid="button-admin-logout"><LogOut className="h-4 w-4" />Lock</button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          ["Live spots", stats?.spots], ["Pending", stats?.pending], ["Reviews", stats?.reviews],
          ["Crew votes", stats?.votes], ["Ad views", stats?.impressions], ["Crew accounts", stats?.users],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-card-border bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">{l}</p>
            <p className="font-code text-lg font-bold tabular" data-testid={`stat-${String(l).replace(/\s/g, "-").toLowerCase()}`}>{v ?? "–"}</p>
          </div>
        ))}
      </div>
      <Tabs defaultValue="spots">
        <TabsList>
          <TabsTrigger value="spots" data-testid="tab-spots">Spots</TabsTrigger>
          <TabsTrigger value="check" data-testid="tab-check">Needs check</TabsTrigger>
          <TabsTrigger value="bulk" data-testid="tab-bulk">Import / Export</TabsTrigger>
          <TabsTrigger value="ads" data-testid="tab-ads">Ad banners</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">Crew</TabsTrigger>
        </TabsList>
        <TabsContent value="spots"><SpotsTable /></TabsContent>
        <TabsContent value="check"><NeedsCheck /></TabsContent>
        <TabsContent value="bulk"><Bulk /></TabsContent>
        <TabsContent value="ads"><AdsManager /></TabsContent>
        <TabsContent value="users"><UsersAdmin /></TabsContent>
      </Tabs>
    </div>
  );
}

function invalidateAll() {
  queryClient.invalidateQueries({ queryKey: ["/api/admin/spots"] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
  queryClient.invalidateQueries({ queryKey: ["/api/search"] });
  queryClient.invalidateQueries({ queryKey: ["/api/airports"] });
}

function SpotsTable() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SpotWithStats[]>({ queryKey: ["/api/admin/spots"], queryFn: admGet("/api/admin/spots") });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState("all");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<SpotWithStats | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data || []).filter((s) =>
      (cat === "all" || s.category === cat) && (status === "all" || s.status === status) &&
      (!t || `${s.name} ${s.icao} ${s.airport?.iata ?? ""} ${s.airport?.city ?? ""} ${s.submittedBy}`.toLowerCase().includes(t)));
  }, [data, q, cat, status]);

  const bulk = useMutation({
    mutationFn: async (p: { action: string; value?: string }) => (await adm("POST", "/api/admin/spots/bulk", { ids: Array.from(sel), ...p })).json(),
    onSuccess: (r: { changed: number }) => { toast({ title: `Updated ${r.changed} spot${r.changed === 1 ? "" : "s"}` }); setSel(new Set()); invalidateAll(); },
  });

  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-3 mt-3">
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, city, submitter" data-testid="input-admin-search" className={cn(inputCls, "max-w-xs")} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={cn(inputCls, "w-auto")} data-testid="select-admin-cat">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_META[c].label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inputCls, "w-auto")} data-testid="select-admin-status">
          <option value="all">All statuses</option><option value="live">Live</option><option value="pending">Pending</option><option value="hidden">Hidden</option>
        </select>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-3 py-2" data-testid="bar-bulk">
          <span className="text-sm font-semibold tabular">{sel.size} selected</span>
          <button className={btn} onClick={() => bulk.mutate({ action: "status", value: "live" })} data-testid="button-bulk-live"><Eye className="h-4 w-4" />Publish</button>
          <button className={btn} onClick={() => bulk.mutate({ action: "status", value: "hidden" })} data-testid="button-bulk-hide"><EyeOff className="h-4 w-4" />Hide</button>
          <select className={cn(inputCls, "w-auto")} value="" onChange={(e) => e.target.value && bulk.mutate({ action: "category", value: e.target.value })} data-testid="select-bulk-category">
            <option value="">Move to category…</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_META[c].label}</option>)}
          </select>
          <button className={cn(btn, "text-destructive")} onClick={() => setConfirmDel(true)} data-testid="button-bulk-delete"><Trash2 className="h-4 w-4" />Delete</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-card-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 p-2.5"><Checkbox checked={allSel} onCheckedChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} data-testid="checkbox-all" aria-label="Select all" /></th>
              <th className="p-2.5 text-left font-medium">Field</th>
              <th className="p-2.5 text-left font-medium">Name</th>
              <th className="p-2.5 text-left font-medium">Cat</th>
              <th className="p-2.5 text-left font-medium">Cost</th>
              <th className="p-2.5 text-left font-medium">Rating</th>
              <th className="p-2.5 text-left font-medium">Crew votes</th>
              <th className="p-2.5 text-left font-medium">Status</th>
              <th className="p-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="p-3"><Skeleton className="h-6" /></td></tr>}
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-border" data-testid={`row-spot-${s.id}`}>
                <td className="p-2.5"><Checkbox checked={sel.has(s.id)} onCheckedChange={() => toggle(s.id)} data-testid={`checkbox-spot-${s.id}`} aria-label={`Select ${s.name}`} /></td>
                <td className="p-2.5 font-code text-xs font-bold">{s.icao}</td>
                <td className="p-2.5"><p className="font-medium leading-tight">{s.name}</p><p className="text-xs text-muted-foreground">{s.submittedBy}</p></td>
                <td className="p-2.5 text-xs">{CAT_META[s.category as keyof typeof CAT_META]?.label}</td>
                <td className="p-2.5 font-code text-xs" title={s.costVotes ? `${s.costVotes} price vote(s); submitter set ${COST_LABELS[s.costLevel]}` : ""}>{costText(s) || "–"}</td>
                <td className="p-2.5 text-xs tabular">{s.reviewCount ? `${s.avgRating?.toFixed(1)} (${s.reviewCount})` : "—"}</td>
                <td className="p-2.5"><VetBadge vet={s.vet} /></td>
                <td className="p-2.5"><span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", s.status === "live" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : s.status === "pending" ? "bg-primary/20" : "bg-muted text-muted-foreground")}>{s.status}</span></td>
                <td className="p-2.5 text-right"><button onClick={() => setEdit(s)} className="h-8 w-8 grid place-items-center rounded-lg hover-elevate" aria-label="Edit" data-testid={`button-edit-${s.id}`}><Pencil className="h-4 w-4" /></button></td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-sm text-muted-foreground">No spots match.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && <EditSpot spot={edit} onClose={() => setEdit(null)} />}

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {sel.size} spot{sel.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the spots and their reviews. Export a CSV first if you want a backup.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulk.mutate({ action: "delete" })} data-testid="button-confirm-delete">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function L({ l, children, className }: { l: string; children: React.ReactNode; className?: string }) {
  return <label className={cn("block", className)}><span className="text-xs text-muted-foreground">{l}</span><div className="mt-1">{children}</div></label>;
}

function EditSpot({ spot, onClose }: { spot: SpotWithStats; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    icao: spot.icao, category: spot.category, name: spot.name, description: spot.description, address: spot.address || "",
    website: spot.website || "", costLevel: spot.costLevel, minutesNeeded: spot.minutesNeeded, milesFromField: spot.milesFromField ?? 0,
    pace: paceOf(spot) || "", crewTip: spot.crewTip || "", tags: (() => { try { return JSON.parse(spot.tags).join(", "); } catch { return ""; } })(), status: spot.status, submittedBy: spot.submittedBy || "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: async () => (await adm("PATCH", `/api/admin/spots/${spot.id}`, {
      ...f, pace: f.category === "eat" && f.pace ? f.pace : null, costLevel: Number(f.costLevel), minutesNeeded: Number(f.minutesNeeded), milesFromField: Number(f.milesFromField),
      tags: JSON.stringify(String(f.tags).split(",").map((t: string) => t.trim()).filter(Boolean)),
    })).json(),
    onSuccess: () => { toast({ title: "Saved" }); invalidateAll(); queryClient.invalidateQueries({ queryKey: ["/api/spots"] }); onClose(); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit spot #{spot.id}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <L l="Name" className="col-span-2"><input className={inputCls} value={f.name} onChange={set("name")} data-testid="input-edit-name" /></L>
          <L l="ICAO"><input className={inputCls + " font-code uppercase"} value={f.icao} onChange={set("icao")} data-testid="input-edit-icao" /></L>
          <L l="Category"><select className={inputCls} value={f.category} onChange={set("category")} data-testid="select-edit-category">{CATEGORIES.map((c) => <option key={c} value={c}>{CAT_META[c].label}</option>)}</select></L>
          <L l="Description" className="col-span-2"><textarea rows={3} className={inputCls + " h-auto py-2"} value={f.description} onChange={set("description")} data-testid="input-edit-description" /></L>
          <L l="Submitter price (0–4)"><select className={inputCls} value={f.costLevel} onChange={set("costLevel")} data-testid="select-edit-cost">{COST_LABELS.map((c, i) => <option key={c} value={i}>{c}</option>)}</select></L>
          {f.category === "eat" && <L l="Pace"><select className={inputCls} value={f.pace} onChange={set("pace")} data-testid="select-edit-pace"><option value="grab">Grab & go</option><option value="sit">Sit-down</option></select></L>}
          <L l="Minutes needed"><input type="number" className={inputCls} value={f.minutesNeeded} onChange={set("minutesNeeded")} data-testid="input-edit-minutes" /></L>
          <L l="Miles from field"><input type="number" step="0.1" className={inputCls} value={f.milesFromField} onChange={set("milesFromField")} data-testid="input-edit-miles" /></L>
          <L l="Status"><select className={inputCls} value={f.status} onChange={set("status")} data-testid="select-edit-status"><option value="live">Live</option><option value="pending">Pending</option><option value="hidden">Hidden</option></select></L>
          <L l="Crew tip" className="col-span-2"><input className={inputCls} value={f.crewTip} onChange={set("crewTip")} data-testid="input-edit-tip" /></L>
          <L l="Address" className="col-span-2"><input className={inputCls} value={f.address} onChange={set("address")} /></L>
          <L l="Website"><input className={inputCls} value={f.website} onChange={set("website")} /></L>
          <L l="Tags (comma)"><input className={inputCls} value={f.tags} onChange={set("tags")} /></L>
          <L l="Submitted by" className="col-span-2"><input className={inputCls} value={f.submittedBy} onChange={set("submittedBy")} /></L>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className={btn} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={() => m.mutate()} disabled={m.isPending} data-testid="button-save-spot">{m.isPending ? "Saving…" : "Save"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NeedsCheck() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SpotWithStats[]>({ queryKey: ["/api/admin/spots"], queryFn: admGet("/api/admin/spots") });
  const [edit, setEdit] = useState<SpotWithStats | null>(null);
  const rows = (data || []).filter((s) => s.vet.level === "needs_check" || s.status === "pending")
    .sort((a, b) => b.vet.down - a.vet.down);
  const keep = useMutation({
    mutationFn: async (id: number) => adm("POST", `/api/admin/spots/${id}/clear-downvotes`),
    onSuccess: () => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ["/api/spots"] }); toast({ title: "Downvotes cleared — listing is live" }); },
  });
  const hide = useMutation({
    mutationFn: async (id: number) => adm("POST", "/api/admin/spots/bulk", { ids: [id], action: "status", value: "hidden" }),
    onSuccess: () => { invalidateAll(); toast({ title: "Listing hidden" }); },
  });
  const label = (id: string) => DOWN_REASONS.find((r) => r.id === id)?.label || id;
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">
        Listings crews have voted down (2+ downvotes, 40%+ negative) or that were pulled automatically (5+ downvotes, 60%+ negative) and are waiting for review.
        Verify the listing, then edit it, keep it and clear the downvotes, or hide it.
      </p>
      {isLoading && <Skeleton className="h-24 rounded-2xl" />}
      {!isLoading && rows.length === 0 && <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing needs a check right now.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((s) => (
          <div key={s.id} className="rounded-2xl border border-card-border bg-card p-4 space-y-2.5" data-testid={`card-check-${s.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground"><span className="font-code font-bold text-foreground">{s.icao}</span> · {CAT_META[s.category as keyof typeof CAT_META]?.label}</p>
                <p className="text-sm font-semibold">{s.name}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <VetBadge vet={s.vet} />
                {s.status !== "live" && <span className="rounded-md bg-primary/20 px-1.5 py-0.5 text-[11px] font-semibold">{s.status === "pending" ? "Pulled — awaiting review" : s.status}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(s.vet.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <span key={k} className="rounded-md bg-orange-500/15 px-2 py-0.5 text-xs text-orange-700 dark:text-orange-400">{label(k)} · {n}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button className={btnPrimary} onClick={() => keep.mutate(s.id)} data-testid={`button-keep-${s.id}`}>Keep & clear downvotes</button>
              <button className={btn} onClick={() => setEdit(s)} data-testid={`button-check-edit-${s.id}`}><Pencil className="h-4 w-4" />Edit</button>
              <button className={cn(btn, "text-destructive")} onClick={() => hide.mutate(s.id)} data-testid={`button-hide-${s.id}`}><EyeOff className="h-4 w-4" />Hide</button>
            </div>
          </div>
        ))}
      </div>
      {edit && <EditSpot spot={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

const TEMPLATE = `id,icao,category,name,description,address,website,costLevel,minutesNeeded,pace,milesFromField,lat,lng,crewTip,tags,submittedBy,status,airportCity,airportName
,KOPF,eat,Example Café,Great cafecito near the field,123 Main St,,1,30,grab,1.5,,,Ask for crew discount,coffee; quick,Admin import,live,,
,KXYZ,do,New Field Example,Unknown airports are created automatically when airportCity is filled,,,0,120,,3,,,,outdoors,Admin import,live,Sample Town,Sample Regional`;

function Bulk() {
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const m = useMutation({
    mutationFn: async () => (await adm("POST", "/api/admin/import", { csv })).json(),
    onSuccess: (r) => { setResult(r); invalidateAll(); toast({ title: `Imported: ${r.created} new, ${r.updated} updated` }); },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });
  const exportUrl = `${API_BASE}/api/admin/export.csv?key=${encodeURIComponent(ADMIN_KEY)}`;
  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Import CSV</h2>
          <div className="flex gap-2">
            <button className={btn} onClick={() => setCsv(TEMPLATE)} data-testid="button-load-template">Load template</button>
            <label className={cn(btn, "cursor-pointer")} data-testid="button-upload-csv">
              <Upload className="h-4 w-4" />Choose file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0]; if (!file) return;
                const r = new FileReader(); r.onload = () => setCsv(String(r.result || "")); r.readAsText(file);
              }} />
            </label>
          </div>
        </div>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10} placeholder="Paste CSV here, or choose a file." data-testid="input-csv"
          className="w-full rounded-xl border border-input bg-background p-3 font-code text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
        <div className="flex items-center gap-3">
          <button className={btnPrimary} disabled={!csv.trim() || m.isPending} onClick={() => m.mutate()} data-testid="button-import">{m.isPending ? "Importing…" : "Import rows"}</button>
          <p className="text-xs text-muted-foreground">Rows with an existing <span className="font-code">id</span> are updated; blank id creates new.</p>
        </div>
        {result && (
          <div className="rounded-xl bg-muted/60 p-3 text-sm" data-testid="text-import-result">
            <p><b>{result.created}</b> created · <b>{result.updated}</b> updated · <b>{result.errors.length}</b> errors</p>
            {result.errors.map((e) => <p key={e} className="text-xs text-destructive mt-1">{e}</p>)}
          </div>
        )}
      </div>
      <div className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
        <h2 className="text-sm font-semibold">Export</h2>
        <p className="text-sm text-muted-foreground">Download every spot (all statuses) as CSV. Edit in Excel or Google Sheets, then re-import to bulk update.</p>
        {IS_STATIC ? (
          <button className={btnPrimary} data-testid="link-export" onClick={async () => {
            const { exportCsv } = await import("@/lib/mockApi");
            const blob = new Blob([exportCsv()], { type: "text/csv" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
            a.download = `wheelsdown-spots-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }}><Download className="h-4 w-4" />Download CSV</button>
        ) : (
          <a href={exportUrl} target="_blank" rel="noopener noreferrer" className={btnPrimary} data-testid="link-export"><Download className="h-4 w-4" />Download CSV</a>
        )}
        {IS_STATIC && (
          <button className={btn} data-testid="button-reset-demo" onClick={async () => {
            (await import("@/lib/mockApi")).resetDemo(); queryClient.invalidateQueries(); toast({ title: "Demo data reset" });
          }}>Reset demo data</button>
        )}
        <div className="pt-2 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Columns</p>
          <p><span className="font-code">category</span>: eat, do, stay, fbo</p>
          <p><span className="font-code">costLevel</span>: 0 free (Do only) → 4 $$$$; eat and stay use 1–4</p>
          <p><span className="font-code">pace</span>: grab or sit (eat only)</p>
          <p><span className="font-code">status</span>: live, pending, hidden</p>
          <p><span className="font-code">tags</span>: separate with ;</p>
        </div>
      </div>
    </div>
  );
}

const emptyAd = { slot: "inline", advertiser: "", headline: "", body: "", cta: "Learn more", url: "", targetIcao: "", active: 1 };

function AdsManager() {
  const { toast } = useToast();
  const { data } = useQuery<Ad[]>({ queryKey: ["/api/admin/ads"], queryFn: admGet("/api/admin/ads") });
  const [edit, setEdit] = useState<(typeof emptyAd & { id?: number }) | null>(null);
  const inv = () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/ads"] }); queryClient.invalidateQueries({ queryKey: ["/api/ads"] }); queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] }); };
  const save = useMutation({
    mutationFn: async (a: typeof emptyAd & { id?: number }) => {
      const { id, ...body } = a;
      return (await adm(id ? "PATCH" : "POST", id ? `/api/admin/ads/${id}` : "/api/admin/ads", body)).json();
    },
    onSuccess: () => { inv(); setEdit(null); toast({ title: "Ad saved" }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: async (id: number) => adm("DELETE", `/api/admin/ads/${id}`), onSuccess: inv });

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Three placements: <b>top</b> banner, <b>inline</b> (every 4th result & spot pages), <b>footer</b>. Leave target blank for network-wide, or set an ICAO to geo-target.</p>
        <button className={btnPrimary} onClick={() => setEdit({ ...emptyAd })} data-testid="button-new-ad"><Plus className="h-4 w-4" />New ad</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(data || []).map((a) => (
          <div key={a.id} className={cn("rounded-2xl border border-card-border bg-card p-4 space-y-2", !a.active && "opacity-60")} data-testid={`card-ad-${a.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium uppercase">{a.slot}</span>
                <span className="font-code font-bold">{a.targetIcao || "ALL"}</span>
              </div>
              <Switch checked={!!a.active} onCheckedChange={(v) => save.mutate({ ...(a as any), active: v ? 1 : 0 })} data-testid={`switch-ad-${a.id}`} />
            </div>
            <p className="text-xs text-muted-foreground">{a.advertiser}</p>
            <p className="text-sm font-semibold leading-snug">{a.headline}</p>
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground tabular font-code">{a.impressions} views · {a.clicks} clicks · {a.impressions ? ((a.clicks / a.impressions) * 100).toFixed(1) : "0.0"}% CTR</p>
              <div className="flex gap-1">
                <button className="h-8 w-8 grid place-items-center rounded-lg hover-elevate" onClick={() => setEdit({ ...(a as any) })} aria-label="Edit ad" data-testid={`button-edit-ad-${a.id}`}><Pencil className="h-4 w-4" /></button>
                <button className="h-8 w-8 grid place-items-center rounded-lg hover-elevate text-destructive" onClick={() => del.mutate(a.id)} aria-label="Delete ad" data-testid={`button-delete-ad-${a.id}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{edit.id ? "Edit ad" : "New ad"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              {([["advertiser", "Advertiser", 2], ["headline", "Headline", 2], ["body", "Body", 2], ["cta", "Button text", 1], ["targetIcao", "Target ICAO (blank = all)", 1], ["url", "Click URL", 2]] as const).map(([k, l, span]) => (
                <label key={k} className={span === 2 ? "col-span-2" : ""}>
                  <span className="text-xs text-muted-foreground">{l}</span>
                  <input className={inputCls + " mt-1"} value={(edit as any)[k] || ""} onChange={(e) => setEdit({ ...edit, [k]: k === "targetIcao" ? e.target.value.toUpperCase() : e.target.value })} data-testid={`input-ad-${k}`} />
                </label>
              ))}
              <label className="col-span-2"><span className="text-xs text-muted-foreground">Placement</span>
                <select className={inputCls + " mt-1"} value={edit.slot} onChange={(e) => setEdit({ ...edit, slot: e.target.value })} data-testid="select-ad-slot">
                  <option value="top">Top banner</option><option value="inline">Inline (in results)</option><option value="footer">Footer</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className={btn} onClick={() => setEdit(null)}>Cancel</button>
              <button className={btnPrimary} disabled={!edit.advertiser || !edit.headline || save.isPending} onClick={() => save.mutate(edit)} data-testid="button-save-ad">Save ad</button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


function UsersAdmin() {
  const { data } = useQuery<PublicUser[]>({ queryKey: ["/api/admin/users"], queryFn: admGet("/api/admin/users") });
  const [amt, setAmt] = useState<Record<number, string>>({});
  const grant = useMutation({
    mutationFn: ({ id, delta }: { id: number; delta: number }) => adm("POST", `/api/admin/users/${id}/bonus`, { delta }),
    onSuccess: () => { queryClient.invalidateQueries(); },
  });
  return (
    <div className="mt-3 rounded-xl border border-card-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2.5">Crew</th><th className="p-2.5">Status</th><th className="p-2.5 text-right">Points</th><th className="p-2.5">Bonus points</th></tr></thead>
        <tbody className="divide-y divide-border">
          {(data || []).map((u) => (
            <tr key={u.id} data-testid={`row-admin-user-${u.handle}`}>
              <td className="p-2.5"><p className="font-medium leading-tight">{u.displayName}{u.anonymous && <span className="ml-1 text-[10px] uppercase text-muted-foreground">posts anonymously</span>}</p><p className="text-xs text-muted-foreground">@{u.handle} · {u.crewRole}{u.homeBase ? " · " + u.homeBase : ""}</p></td>
              <td className="p-2.5"><TierChip tierId={u.tierId} /></td>
              <td className="p-2.5 text-right font-code font-bold tabular">{u.points.toLocaleString()}</td>
              <td className="p-2.5">
                <div className="flex gap-1.5">
                  <input value={amt[u.id] ?? ""} onChange={(e) => setAmt({ ...amt, [u.id]: e.target.value.replace(/[^0-9-]/g, "") })} placeholder="±pts" className={inputCls + " h-8 w-20"} data-testid={`input-bonus-${u.handle}`} />
                  <button className={btn} disabled={!amt[u.id]} onClick={() => { grant.mutate({ id: u.id, delta: Number(amt[u.id]) }); setAmt({ ...amt, [u.id]: "" }); }} data-testid={`button-bonus-${u.handle}`}>Apply</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-2.5 text-xs text-muted-foreground">Bonus points cover activity outside the app (events, imports, corrections). Everything else is counted from the crew member's activity.</p>
    </div>
  );
}
