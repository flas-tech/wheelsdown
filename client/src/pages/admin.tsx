import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Upload, Trash2, Eye, EyeOff, Plus, Lock, Pencil, LogOut } from "lucide-react";
import { CATEGORIES, DOWN_REASONS, type Ad, type SpotWithStats } from "@shared/schema";
import { apiRequest, queryClient, API_BASE, IS_STATIC } from "@/lib/queryClient";
import { CAT_META, COST_LABELS, VetBadge } from "@/lib/ui";
import { COST_RANGES } from "@shared/cost";
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
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

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
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold">Admin console</h1>
        <button onClick={onLogout} className={btn} data-testid="button-admin-logout"><LogOut className="h-4 w-4" />Lock</button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 print:hidden">
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
      <Tabs defaultValue="mod">
        <TabsList className="print:hidden">
          <TabsTrigger value="mod" data-testid="tab-mod">Moderation</TabsTrigger>
          <TabsTrigger value="adv" data-testid="tab-advertisers">Advertisers</TabsTrigger>
          <TabsTrigger value="spots" data-testid="tab-spots">Spots</TabsTrigger>
          <TabsTrigger value="check" data-testid="tab-check">Needs check</TabsTrigger>
          <TabsTrigger value="bulk" data-testid="tab-bulk">Import / Export</TabsTrigger>
          <TabsTrigger value="ads" data-testid="tab-ads">Ad banners</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">Crew</TabsTrigger>
        </TabsList>
        <TabsContent value="mod"><ModerationQueue /></TabsContent>
        <TabsContent value="adv"><AdvertiserReport /></TabsContent>
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
          <option value="all">All statuses</option><option value="live">Live</option><option value="pending">Pending</option><option value="hidden">Hidden</option><option value="rejected">Rejected</option>
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
          <L l="Submitter price (0–4)"><select className={inputCls} value={f.costLevel} onChange={set("costLevel")} data-testid="select-edit-cost">{COST_LABELS.map((c, i) => <option key={c} value={i}>{c}{i > 0 && COST_RANGES[f.category]?.[i] ? ` (${COST_RANGES[f.category][i]})` : ""}</option>)}</select></L>
          {f.category === "eat" && <L l="Pace"><select className={inputCls} value={f.pace} onChange={set("pace")} data-testid="select-edit-pace"><option value="grab">Grab & go</option><option value="both">Both</option><option value="sit">Sit-down</option></select></L>}
          <L l="Minutes needed"><input type="number" className={inputCls} value={f.minutesNeeded} onChange={set("minutesNeeded")} data-testid="input-edit-minutes" /></L>
          <L l="Miles from field"><input type="number" step="0.1" className={inputCls} value={f.milesFromField} onChange={set("milesFromField")} data-testid="input-edit-miles" /></L>
          <L l="Status"><select className={inputCls} value={f.status} onChange={set("status")} data-testid="select-edit-status"><option value="live">Live</option><option value="pending">Pending</option><option value="hidden">Hidden</option><option value="rejected">Rejected</option></select></L>
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

type ModSpot = SpotWithStats & { modState: string; modNote: string; pendingEdit: string | null };
type ModReview = { id: number; spotId: number; spotName: string; icao: string; rating: number; comment: string; author: string; status: string; modState: string; modNote: string; pendingEdit: string | null; createdAt: number };
type LogRow = { id: number; kind: "spot" | "review"; targetId: number; actor: string; action: string; problem: string; reason: string; isEdit: number; before: string | null; after: string | null; createdAt: number;
  latest: boolean; exists: boolean; name: string; icao: string; spotId: number | null; by: string; status: string; modState: string; hasPendingEdit: boolean };
type ModData = { ai: boolean; manual: boolean; spots: ModSpot[]; reviews: ModReview[]; log: LogRow[];
  status: { lastRunAt: number; lastError: string; lastErrorAt: number; checking: number; held: number; approved24h: number; held24h: number; errors24h: number; overrides24h: number } };
const PROBLEM = (note: string) => /^\[([a-z_]+)\]/.exec(note)?.[1]?.replace(/_/g, " ") || "";
const NOTE = (note: string) => note.replace(/^\[[a-z_]+\]\s*/, "").replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
const FIELD: Record<string, string> = { name: "Name", description: "Description", address: "Address", website: "Website", costLevel: "Price", pace: "Pace", minutesNeeded: "Time needed", milesFromField: "Miles from field", crewTip: "Crew tip", tags: "Tags", category: "Category", icao: "Airport", rating: "Rating", comment: "Comment", lat: "Latitude", lng: "Longitude", placeRef: "Map place" };
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const parse = (j: string | null) => { try { return j ? JSON.parse(j) : null; } catch { return null; } };
const fmtVal = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "string" && v.startsWith("[") ? (parse(v) || []).join(", ") || "–" : String(v));

function Diff({ before, after }: { before: Record<string, any> | null; after: Record<string, any> | null }) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  if (!keys.length) return null;
  return (
    <div className="rounded-lg bg-muted/50 p-2 text-xs space-y-1" data-testid="mod-diff">
      {keys.map((k) => <p key={k} className="break-words"><span className="font-semibold">{FIELD[k] || k}:</span> {before && <><span className="line-through text-muted-foreground">{fmtVal(before[k])}</span> → </>}{fmtVal(after?.[k])}</p>)}
    </div>
  );
}

/** Current state of the item, in words. */
function StateChip({ status, modState, hasPendingEdit }: { status: string; modState: string; hasPendingEdit: boolean }) {
  const [label, tone] = status === "deleted" ? ["Deleted", "muted"]
    : modState === "checking" ? ["AI checking", "blue"]
    : hasPendingEdit ? [modState === "awaiting" ? "Edit waiting for you" : "Edit held", "orange"]
    : status === "live" ? ["Live", "green"]
    : status === "rejected" ? ["Removed", "muted"]
    : modState === "awaiting" ? ["Waiting for you", "orange"]
    : status === "pending" ? ["Not public", "orange"] : [status, "muted"];
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", tone === "green" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : tone === "orange" ? "bg-orange-500/15 text-orange-700 dark:text-orange-300" : tone === "blue" ? "bg-primary/20" : "bg-muted text-muted-foreground")} data-testid="chip-mod-state">{label}</span>;
}
function VerdictChip({ actor, action }: { actor: string; action: string }) {
  const ai = actor === "ai";
  const label = ai ? { approve: "AI approved", hold: "AI held", error: "AI couldn't check" }[action] || `AI ${action}`
    : { approve: "You approved", reject: "You denied", revert: "You undid edit", recheck: "You re-ran AI" }[action] || action;
  const good = action === "approve";
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", ai ? (good ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-orange-500/10 text-orange-700 dark:text-orange-300") : "bg-foreground text-background")}>{label}</span>;
}

const approveBtn = "inline-flex items-center justify-center gap-1.5 h-10 min-w-[104px] rounded-lg px-4 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-35 disabled:hover:bg-emerald-600";
const denyBtn = "inline-flex items-center justify-center gap-1.5 h-10 min-w-[104px] rounded-lg px-4 text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-35 disabled:hover:bg-red-600";

/** Admin view of AI moderation: live status, what's waiting, every decision, and Approve / Deny overrides. */
function ModerationQueue() {
  const { toast } = useToast();
  const [view, setView] = useState<"needs" | "all">("needs");
  const [filter, setFilter] = useState<"all" | "ai_ok" | "ai_held" | "mine">("all");
  const { data, isLoading } = useQuery<ModData>({ queryKey: ["/api/admin/moderation"], queryFn: admGet("/api/admin/moderation"), refetchInterval: 6000 });
  const done = () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation"] }); invalidateAll(); };
  const act = useMutation({
    mutationFn: async (a: { kind: "spot" | "review"; id: number; action: "approve" | "reject" | "recheck" }) => (await adm("POST", `/api/admin/moderation/${a.kind}/${a.id}`, { action: a.action })).json(),
    onSuccess: (_r, a) => { done(); toast({ title: a.action === "approve" ? "Approved: it's live" : a.action === "reject" ? "Denied: it's off the site" : "Checking again" }); },
    onError: (e: Error) => toast({ title: "Didn't go through", description: e.message, variant: "destructive" }),
  });
  const revert = useMutation({
    mutationFn: async (logId: number) => (await adm("POST", `/api/admin/moderation/revert/${logId}`)).json(),
    onSuccess: () => { done(); toast({ title: "Edit undone", description: "The previous version is back." }); },
    onError: (e: Error) => toast({ title: "Couldn't undo", description: e.message, variant: "destructive" }),
  });
  const setManual = useMutation({
    mutationFn: async (manual: boolean) => (await adm("PUT", "/api/admin/moderation/settings", { manual })).json(),
    onSuccess: (r: { manual: boolean }) => { done(); toast({ title: r.manual ? "AI approvals now wait for you" : "AI approvals publish automatically" }); },
  });
  if (isLoading || !data) return <Skeleton className="h-32 rounded-xl" />;
  const st = data.status;
  const busy = act.isPending || revert.isPending;
  const spots = data.spots.filter((s) => s.status !== "rejected");
  const reviews = data.reviews.filter((r) => r.status !== "rejected");
  const needs = spots.length + reviews.length;
  const log = data.log.filter((r) => filter === "all" || (filter === "ai_ok" ? r.actor === "ai" && r.action === "approve" : filter === "ai_held" ? r.actor === "ai" && r.action !== "approve" : r.actor === "admin"));

  // Buttons for a decision row. Only the newest row per item acts on the item; older rows are history.
  const rowButtons = (r: LogRow) => {
    if (!r.latest || !r.exists || r.modState === "checking") return null;
    const editApplied = !!r.isEdit && r.action === "approve" && !!r.before && !r.hasPendingEdit && r.modState !== "awaiting";
    const isLive = r.status === "live" && !r.hasPendingEdit;
    return (
      <div className="flex flex-wrap gap-2">
        <button className={approveBtn} disabled={busy || isLive} onClick={() => act.mutate({ kind: r.kind, id: r.targetId, action: "approve" })} data-testid={`button-log-approve-${r.id}`}>Approve</button>
        {editApplied
          ? <button className={denyBtn} disabled={busy} onClick={() => revert.mutate(r.id)} data-testid={`button-log-revert-${r.id}`}>Deny: undo edit</button>
          : <button className={denyBtn} disabled={busy || (r.status === "rejected" && !r.hasPendingEdit)} onClick={() => act.mutate({ kind: r.kind, id: r.targetId, action: "reject" })} data-testid={`button-log-deny-${r.id}`}>{r.hasPendingEdit ? "Deny edit" : "Deny"}</button>}
        <button className={btn} disabled={busy || !data.ai} onClick={() => act.mutate({ kind: r.kind, id: r.targetId, action: "recheck" })}>Re-run AI</button>
      </div>
    );
  };

  return (
    <div className="space-y-4 pt-3" data-testid="panel-moderation">
      {/* status */}
      <div className="rounded-xl border border-card-border bg-card p-3 space-y-3" data-testid="mod-status">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", data.ai ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
            <span className={cn("h-2 w-2 rounded-full", data.ai ? "bg-emerald-500" : "bg-muted-foreground")} />AI moderation {data.ai ? "on" : "off"}
          </span>
          {data.ai && <span className="text-xs text-muted-foreground">Checker last ran {st.lastRunAt ? ago(st.lastRunAt) : "not yet since restart"}</span>}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {([["Checking now", st.checking], ["Needs you", needs], ["AI approved 24h", st.approved24h], ["AI held 24h", st.held24h], ["AI errors 24h", st.errors24h], ["Your overrides 24h", st.overrides24h]] as const).map(([l, v]) => (
            <div key={l} className="rounded-lg border border-card-border px-2.5 py-2"><p className="text-[10.5px] text-muted-foreground leading-tight">{l}</p><p className="font-code text-base font-bold tabular">{v}</p></div>
          ))}
        </div>
        {st.lastError && Date.now() - st.lastErrorAt < 6 * 3600_000 && <p className="text-xs text-orange-700 dark:text-orange-300">Last AI error {ago(st.lastErrorAt)}: {st.lastError}</p>}
        <label className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 p-2.5">
          <span className="text-sm"><span className="font-semibold">Hold AI approvals for me</span><br /><span className="text-xs text-muted-foreground">On: nothing publishes until you tap Approve; the AI only recommends. Off: AI approvals go live on their own, and you can still Deny them later.</span></span>
          <Switch checked={data.manual} onCheckedChange={(v) => setManual.mutate(v)} data-testid="switch-mod-manual" />
        </label>
      </div>

      <div className="inline-flex rounded-lg border border-border p-0.5">
        {([["needs", `Needs you (${needs})`], ["all", "All decisions"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={cn("h-8 rounded-md px-3 text-sm font-medium", view === k ? "bg-foreground text-background" : "text-muted-foreground")} data-testid={`button-mod-view-${k}`}>{l}</button>
        ))}
      </div>

      {view === "needs" ? (
        <div className="space-y-2">
          {!needs && <p className="text-sm text-muted-foreground">Nothing is waiting. Everything the AI approved is live; check All decisions to review or undo any of it.</p>}
          {spots.map((s) => {
            const edit = parse(s.pendingEdit);
            const changed = edit ? Object.fromEntries(Object.keys(edit).filter((k) => String(edit[k] ?? "") !== String((s as any)[k] ?? "")).map((k) => [k, edit[k]])) : null;
            const before = changed ? Object.fromEntries(Object.keys(changed).map((k) => [k, (s as any)[k]])) : null;
            return (
              <article key={`s${s.id}`} className="rounded-xl border border-card-border bg-card p-3 space-y-2" data-testid={`mod-spot-${s.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[11px] font-semibold uppercase text-muted-foreground">{edit ? "Listing edit" : "New listing"}</span>
                  <span className="font-code text-xs font-bold">{s.icao}</span>
                  <a href={`#/spot/${s.id}`} className="font-medium underline-offset-2 hover:underline">{s.name}</a>
                  <span className="text-xs text-muted-foreground">{s.category} · by {s.submittedBy}</span>
                  <StateChip status={s.status} modState={s.modState} hasPendingEdit={!!edit} />
                  {PROBLEM(s.modNote) && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">AI: {PROBLEM(s.modNote)}</span>}
                </div>
                {s.modNote && <p className="text-xs"><span className="font-semibold">AI says:</span> {NOTE(s.modNote)}</p>}
                {edit ? <Diff before={before} after={changed} /> : <p className="text-xs text-muted-foreground line-clamp-3">{s.description || "No description"}{s.address ? ` · ${s.address}` : ""}{s.website ? ` · ${s.website}` : ""}</p>}
                {s.modState !== "checking" && (
                  <div className="flex flex-wrap gap-2">
                    <button className={approveBtn} disabled={busy} onClick={() => act.mutate({ kind: "spot", id: s.id, action: "approve" })} data-testid={`button-mod-approve-spot-${s.id}`}>Approve</button>
                    <button className={denyBtn} disabled={busy} onClick={() => act.mutate({ kind: "spot", id: s.id, action: "reject" })} data-testid={`button-mod-reject-spot-${s.id}`}>{edit ? "Deny edit" : "Deny"}</button>
                    <button className={btn} disabled={busy || !data.ai} onClick={() => act.mutate({ kind: "spot", id: s.id, action: "recheck" })}>Re-run AI</button>
                  </div>
                )}
              </article>
            );
          })}
          {reviews.map((r) => {
            const edit = parse(r.pendingEdit);
            const shown = edit || r;
            return (
              <article key={`r${r.id}`} className="rounded-xl border border-card-border bg-card p-3 space-y-2" data-testid={`mod-review-${r.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[11px] font-semibold uppercase text-muted-foreground">{edit ? "Rating edit" : "New rating"}</span>
                  <span className="font-code text-xs font-bold">{r.icao}</span>
                  <a href={`#/spot/${r.spotId}`} className="font-medium underline-offset-2 hover:underline">{r.spotName}</a>
                  <span className="text-xs text-muted-foreground">by {r.author} · {shown.rating === 0 ? "Go around" : `${shown.rating}/5`}</span>
                  <StateChip status={r.status} modState={r.modState} hasPendingEdit={!!edit} />
                  {PROBLEM(r.modNote) && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">AI: {PROBLEM(r.modNote)}</span>}
                </div>
                {r.modNote && <p className="text-xs"><span className="font-semibold">AI says:</span> {NOTE(r.modNote)}</p>}
                {edit ? <Diff before={{ rating: r.rating, comment: r.comment }} after={{ rating: edit.rating, comment: edit.comment }} /> : <p className="rounded-lg bg-muted/50 p-2 text-xs">{r.comment || "No comment"}</p>}
                {r.modState !== "checking" && (
                  <div className="flex flex-wrap gap-2">
                    <button className={approveBtn} disabled={busy} onClick={() => act.mutate({ kind: "review", id: r.id, action: "approve" })} data-testid={`button-mod-approve-review-${r.id}`}>Approve</button>
                    <button className={denyBtn} disabled={busy} onClick={() => act.mutate({ kind: "review", id: r.id, action: "reject" })} data-testid={`button-mod-reject-review-${r.id}`}>{edit ? "Deny edit" : "Deny"}</button>
                    <button className={btn} disabled={busy || !data.ai} onClick={() => act.mutate({ kind: "review", id: r.id, action: "recheck" })}>Re-run AI</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {([["all", "Everything"], ["ai_ok", "AI approved"], ["ai_held", "AI held"], ["mine", "Your overrides"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={cn("h-8 rounded-full border px-3 text-xs font-medium", filter === k ? "border-primary bg-primary/10" : "border-border text-muted-foreground")} data-testid={`button-mod-filter-${k}`}>{l}</button>
            ))}
          </div>
          {!log.length && <p className="text-sm text-muted-foreground">No decisions yet.</p>}
          {log.map((r) => {
            const before = parse(r.before), after = parse(r.after);
            return (
              <article key={r.id} className={cn("rounded-xl border bg-card p-3 space-y-2", r.latest ? "border-card-border" : "border-dashed border-border opacity-75")} data-testid={`mod-log-${r.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <VerdictChip actor={r.actor} action={r.action} />
                  <span className="text-[11px] font-semibold uppercase text-muted-foreground">{r.kind === "spot" ? "Listing" : "Rating"}{r.isEdit ? " edit" : ""}</span>
                  {r.icao && <span className="font-code text-xs font-bold">{r.icao}</span>}
                  {r.spotId ? <a href={`#/spot/${r.spotId}`} className="font-medium underline-offset-2 hover:underline">{r.name}</a> : <span className="font-medium">{r.name}</span>}
                  {r.by && <span className="text-xs text-muted-foreground">by {r.by}</span>}
                  <span className="text-xs text-muted-foreground">· {ago(r.createdAt)}</span>
                  {r.latest ? <StateChip status={r.status} modState={r.modState} hasPendingEdit={r.hasPendingEdit} /> : <span className="text-[11px] text-muted-foreground">earlier decision</span>}
                </div>
                {(r.problem && r.problem !== "none" || r.reason) && <p className="text-xs">{r.problem && r.problem !== "none" && <span className="mr-1 rounded bg-muted px-1 py-px text-[11px]">{r.problem.replace(/_/g, " ")}</span>}{NOTE(r.reason)}</p>}
                {r.isEdit ? <Diff before={before} after={after} /> : after && r.kind === "review" ? <p className="rounded-lg bg-muted/50 p-2 text-xs">{after.rating === 0 ? "Go around" : `${after.rating}/5`} · {after.comment || "No comment"}</p>
                  : after && r.kind === "spot" ? <p className="text-xs text-muted-foreground line-clamp-2">{after.description || "No description"}{after.address ? ` · ${after.address}` : ""}</p> : null}
                {rowButtons(r)}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Advertisers: audience and performance numbers to show sponsors ----------
type AdvReport = {
  days: number; since: string;
  traffic: { visitors: number; crewActive: number; visits: number; pageviews: number; searches: number; spotViews: number; outbound: number; shares: number; signups: number };
  series: { day: string; visitors: number; crew: number; pageviews: number }[];
  pages: Record<string, number>; outbound: Record<string, number>; devices: Record<string, number>;
  airports: { icao: string; name: string; searches: number; views: number }[];
  ads: { id: number; advertiser: string; headline: string; targetIcao: string; active: boolean; impressions: number; clicks: number; lifetimeImpressions: number; lifetimeClicks: number }[];
  audience: { crew: number; newCrew: number; roles: [string, number][]; aircraft: [string, number][]; homeBases: [string, number][]; interests: [string, number][] };
  content: { listings: number; airports: number; eat: number; do: number; stay: number; fbo: number; ratings: number };
};
const PAGE_LABEL: Record<string, string> = { home: "Home / search", spot: "Listing pages", add: "Add a spot", favorites: "Favorites", brief: "Briefings", shared_brief: "Shared briefings", crew: "Crew board", crew_profile: "Crew profiles", following: "Following", logbook: "Logbook", legal: "About & legal", other: "Other" };
const DEVICE_LABEL: Record<string, string> = { iphone_ipad: "iPhone / iPad", android: "Android", desktop: "Desktop", home_screen_app: "Installed to home screen" };
const OUT_LABEL: Record<string, string> = { website: "Business websites", map: "Directions (maps)", phone: "Phone calls", ad: "Ad clicks" };
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const fmt = (n: number) => n.toLocaleString();

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3 break-inside-avoid">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-code text-xl font-bold tabular">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
function Bars({ title, rows, empty = "No data yet" }: { title: string; rows: [string, number][]; empty?: string }) {
  const total = rows.reduce((a, r) => a + r[1], 0);
  return (
    <section className="rounded-xl border border-card-border bg-card p-4 break-inside-avoid">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{empty}</p> : (
        <ul className="mt-3 space-y-2">
          {rows.map(([k, n]) => (
            <li key={k} className="text-xs">
              <div className="flex justify-between gap-2"><span className="truncate">{k}</span><span className="font-code tabular text-muted-foreground">{fmt(n)} · {pct(n, total)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${total ? Math.max(3, (n / total) * 100) : 0}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AdvertiserReport() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<AdvReport>({ queryKey: ["/api/admin/advertisers", days], queryFn: admGet(`/api/admin/advertisers?days=${days}`), refetchInterval: 60000 });
  if (isLoading || !data) return <Skeleton className="h-64 rounded-xl" />;
  const t = data.traffic;
  const adImp = data.ads.reduce((a, x) => a + x.impressions, 0), adClk = data.ads.reduce((a, x) => a + x.clicks, 0);
  const label = (o: Record<string, number>, L: Record<string, string>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => [L[k] || k, n] as [string, number]);
  const devices = label(Object.fromEntries(Object.entries(data.devices).filter(([k]) => k !== "home_screen_app")), DEVICE_LABEL);
  const installs = data.devices.home_screen_app || 0;
  const sinceTxt = new Date(data.since + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const csv = () => {
    const rows: (string | number)[][] = [["section", "metric", "value"], ["period", "days", data.days], ["period", "since", data.since]];
    Object.entries(t).forEach(([k, v]) => rows.push(["traffic", k, v]));
    rows.push(["ads", "impressions", adImp], ["ads", "clicks", adClk], ["ads", "ctr", pct(adClk, adImp)]);
    data.series.forEach((s) => rows.push(["daily", s.day, `${s.visitors} visitors / ${s.crew} crew / ${s.pageviews} page views`]));
    data.airports.forEach((a) => rows.push(["airport", `${a.icao} ${a.name}`, `${a.searches} searches / ${a.views} listing views`]));
    data.ads.forEach((a) => rows.push(["ad", `${a.advertiser}: ${a.headline}`, `${a.impressions} impressions / ${a.clicks} clicks / lifetime ${a.lifetimeImpressions} / ${a.lifetimeClicks}`]));
    rows.push(["audience", "registered crew", data.audience.crew], ["audience", "new crew", data.audience.newCrew]);
    (["roles", "aircraft", "homeBases", "interests"] as const).forEach((k) => data.audience[k].forEach(([n, v]) => rows.push([`audience ${k}`, n, v])));
    devices.forEach(([n, v]) => rows.push(["device", n, v]));
    Object.entries(data.content).forEach(([k, v]) => rows.push(["content", k, v]));
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `wheelsdown-advertiser-metrics-${data.days}d.csv`; a.click();
  };

  return (
    <div className="space-y-4" data-testid="panel-advertisers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Advertiser metrics</h2>
          <p className="text-xs text-muted-foreground">Last {data.days} days, from {sinceTxt}. Bots, link previews, admin and test traffic are excluded. Counts are anonymous.</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <div className="flex rounded-lg border border-border p-0.5">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} data-testid={`button-range-${d}`} className={cn("h-8 rounded-md px-3 text-sm", days === d ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}>{d}d</button>
            ))}
          </div>
          <button className={btn} onClick={csv} data-testid="button-adv-csv"><Download className="h-4 w-4" />CSV</button>
          <button className={btnPrimary} onClick={() => window.print()} data-testid="button-adv-print">Print media kit</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Unique visitors" value={fmt(t.visitors)} sub={`${fmt(t.visits)} ${t.visits === 1 ? "day-visit" : "day-visits"} (one per device per day)`} />
        <Kpi label="Signed-in crew active" value={fmt(t.crewActive)} sub={`${pct(t.crewActive, t.visitors)} of visitors`} />
        <Kpi label="Page views" value={fmt(t.pageviews)} sub={`${t.visits ? (t.pageviews / t.visits).toFixed(1) : "—"} per visit`} />
        <Kpi label="Registered crew" value={fmt(data.audience.crew)} sub={`+${fmt(data.audience.newCrew)} in period`} />
        <Kpi label="Route searches" value={fmt(t.searches)} />
        <Kpi label="Listing views" value={fmt(t.spotViews)} />
        <Kpi label="Taps to businesses" value={fmt(t.outbound)} sub="websites, maps, calls, ads" />
        <Kpi label="Shares" value={fmt(t.shares)} />
        <Kpi label="Ad impressions" value={fmt(adImp)} />
        <Kpi label="Ad clicks" value={fmt(adClk)} />
        <Kpi label="Ad click-through" value={pct(adClk, adImp)} />
        <Kpi label="Home-screen installs" value={fmt(installs)} sub="devices that opened the installed app" />
      </div>

      <section className="rounded-xl border border-card-border bg-card p-4 break-inside-avoid">
        <h3 className="text-sm font-semibold">Daily audience</h3>
        {data.series.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Visits will appear here as crews use the site.</p> : (
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ left: -18, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="pageviews" name="Page views" stroke="hsl(var(--muted-foreground))" fill="hsl(var(--muted-foreground) / 0.12)" />
                <Area type="monotone" dataKey="visitors" name="Visitors" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.25)" />
                <Area type="monotone" dataKey="crew" name="Signed-in crew" stroke="hsl(152 60% 40%)" fill="hsl(152 60% 40% / 0.2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-card-border bg-card p-4 break-inside-avoid">
        <h3 className="text-sm font-semibold">Top airports crews look at</h3>
        <p className="text-xs text-muted-foreground">Where a targeted banner gets seen. Searches count each airport in a route; views are listing pages opened.</p>
        {data.airports.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No searches yet in this period.</p> : (
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Airport</th><th className="py-1 text-right">Searches</th><th className="py-1 text-right">Listing views</th></tr></thead>
            <tbody>{data.airports.map((a) => (
              <tr key={a.icao} className="border-t border-border" data-testid={`row-adv-airport-${a.icao}`}>
                <td className="py-1.5"><span className="font-code font-bold">{a.icao}</span> <span className="text-xs text-muted-foreground">{a.name}</span></td>
                <td className="py-1.5 text-right font-code tabular">{fmt(a.searches)}</td><td className="py-1.5 text-right font-code tabular">{fmt(a.views)}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Bars title="Crew roles" rows={data.audience.roles} />
        <Bars title="Aircraft flown (profile icon)" rows={data.audience.aircraft} />
        <Bars title="Home bases" rows={data.audience.homeBases} />
        <Bars title="Expertise badges" rows={data.audience.interests} />
        <Bars title="Devices" rows={devices} />
        <Bars title="Where they tap out to" rows={label(data.outbound, OUT_LABEL)} />
        <Bars title="Most-used pages" rows={label(data.pages, PAGE_LABEL)} />
        <section className="rounded-xl border border-card-border bg-card p-4 break-inside-avoid">
          <h3 className="text-sm font-semibold">Content inventory</h3>
          <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
            {[["Live listings", data.content.listings], ["Airports covered", data.content.airports], ["Places to eat", data.content.eat], ["Things to do", data.content.do], ["Places to stay", data.content.stay], ["FBOs", data.content.fbo], ["Crew ratings", data.content.ratings]].map(([k, v]) => (
              <div key={k as string} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-code tabular">{fmt(v as number)}</dd></div>
            ))}
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-card-border bg-card p-4 break-inside-avoid">
        <h3 className="text-sm font-semibold">Ad performance</h3>
        {data.ads.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No ad banners yet.</p> : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Advertiser</th><th className="py-1">Targeting</th><th className="py-1 text-right">Impressions</th><th className="py-1 text-right">Clicks</th><th className="py-1 text-right">CTR</th><th className="py-1 text-right">Lifetime</th></tr></thead>
              <tbody>{data.ads.map((a) => (
                <tr key={a.id} className="border-t border-border" data-testid={`row-adv-ad-${a.id}`}>
                  <td className="py-1.5"><p className="font-medium">{a.advertiser}{!a.active && <span className="ml-1.5 text-xs text-muted-foreground">(paused)</span>}</p><p className="text-xs text-muted-foreground truncate max-w-[220px]">{a.headline}</p></td>
                  <td className="py-1.5 font-code text-xs">{a.targetIcao || "All airports"}</td>
                  <td className="py-1.5 text-right font-code tabular">{fmt(a.impressions)}</td>
                  <td className="py-1.5 text-right font-code tabular">{fmt(a.clicks)}</td>
                  <td className="py-1.5 text-right font-code tabular">{pct(a.clicks, a.impressions)}</td>
                  <td className="py-1.5 text-right font-code text-xs tabular text-muted-foreground">{fmt(a.lifetimeImpressions)} / {fmt(a.lifetimeClicks)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
