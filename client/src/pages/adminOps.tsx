// Admin: Overview, Error log, Change log and AI picks. Read-mostly screens; the only writes are resolving errors
// and hiding/refreshing AI picks, and those land in the Change log too.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Eye, EyeOff, Loader2, RefreshCw, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RELEASES } from "@shared/releases";
import { cuisineLabel } from "@shared/cuisine";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

export type AdmApi = { adm: (method: string, url: string, data?: unknown) => Promise<Response>; admGet: <T>(url: string) => () => Promise<T> };

const inputCls = "h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const btn = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-medium border border-border bg-card hover-elevate disabled:opacity-50";
const btnPrimary = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-semibold taxi-sign hover-elevate disabled:opacity-50";

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : new Date(t).toLocaleDateString();
}
const stamp = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
function Chip({ active, onClick, children, testId, tone }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string; tone?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} data-testid={testId}
      className={cn("h-8 shrink-0 rounded-full border px-3 text-xs font-semibold", active ? "border-primary bg-primary text-primary-foreground" : cn("border-border text-muted-foreground hover:text-foreground", tone))}>
      {children}
    </button>
  );
}
const Count = ({ n }: { n?: number }) => (n ? <span className="ml-1 font-code tabular opacity-80">{n}</span> : null);
function SearchBox({ value, onChange, placeholder, testId }: { value: string; onChange: (v: string) => void; placeholder: string; testId: string }) {
  return (
    <label className="relative flex-1 min-w-[180px]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(inputCls, "w-full pl-8 pr-8")} data-testid={testId} />
      {value && <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="h-4 w-4" /></button>}
    </label>
  );
}
const DAYS: [number, string][] = [[1, "24 hours"], [7, "7 days"], [30, "30 days"], [90, "90 days"]];

// ---------------------------------------------------------------- Overview
type Overview = {
  listings: number; pending: number; users: number; newUsers: number; reviews: number; reviewsWeek: number; feedbackNew: number; errorsOpen: number; errors24: number;
  aiAirports: number; aiRows: number; aiClaimed: number; aiBonus: number; changesWeek: number; aiCallsToday: number; aiFailuresToday: number;
  release: { sha: string; at: number } | null;
  recentErrors: { id: number; level: string; source: string; message: string; count: number; last_at: number }[];
  recentChanges: { id: number; kind: string; actor: string; summary: string; at: number }[];
};
export function OverviewPanel({ api, go, stats }: { api: AdmApi; go: (tab: string) => void; stats?: Record<string, number> }) {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/admin/overview"], queryFn: api.admGet("/api/admin/overview"), refetchInterval: 60_000 });
  const cards: { label: string; value: React.ReactNode; sub?: string; tab: string; alert?: boolean; id: string }[] = data ? [
    { id: "live-spots", label: "Live listings", value: data.listings, sub: `${data.pending} waiting for review`, tab: "spots" },
    { id: "crew-accounts", label: "Crew accounts", value: data.users, sub: `${data.newUsers} new this week`, tab: "users" },
    { id: "reviews", label: "Ratings", value: data.reviews, sub: `${data.reviewsWeek} this week`, tab: "mod" },
    { id: "feedback", label: "New feedback", value: data.feedbackNew, sub: "waiting for a reply", tab: "feedback", alert: data.feedbackNew > 0 },
    { id: "errors", label: "Open errors", value: data.errorsOpen, sub: `${data.errors24} in the last 24 h`, tab: "errors", alert: data.errors24 > 0 },
    { id: "ai-picks", label: "AI picks", value: data.aiRows, sub: `${data.aiAirports} airports · ${data.aiClaimed} added by crews`, tab: "aipicks" },
    { id: "ai-calls", label: "AI calls today", value: data.aiCallsToday, sub: data.aiFailuresToday ? `${data.aiFailuresToday} failed` : "none failed", tab: "costs", alert: data.aiFailuresToday > 0 },
    { id: "changes", label: "Changes this week", value: data.changesWeek, sub: data.release ? `Release ${data.release.sha} · ${ago(data.release.at)}` : "admin and system", tab: "changes" },
  ] : [];
  return (
    <div className="space-y-5" data-testid="panel-overview">
      {isLoading || !data ? <Skeleton className="h-40 rounded-xl" /> : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {cards.map((c) => (
            <button key={c.id} type="button" onClick={() => go(c.tab)} data-testid={`card-overview-${c.id}`}
              className={cn("rounded-xl border bg-card px-3.5 py-3 text-left hover-elevate", c.alert ? "border-primary/60" : "border-card-border")}>
              <p className="text-[11px] font-medium text-muted-foreground">{c.label}</p>
              <p className="mt-0.5 font-code text-2xl font-bold tabular" data-testid={`stat-${c.id}`}>{c.value}</p>
              {c.sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.sub}</p>}
            </button>
          ))}
        </div>
      )}
      {stats && (
        <p className="text-[11px] text-muted-foreground" data-testid="text-overview-extra">{stats.votes ?? 0} crew votes · {stats.impressions ?? 0} ad views · {stats.clicks ?? 0} ad clicks</p>
      )}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-card-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold">Latest open errors</h3>
              <button type="button" onClick={() => go("errors")} className="text-xs font-semibold text-primary">Error log</button>
            </div>
            {data.recentErrors.length ? (
              <ul className="divide-y divide-border">
                {data.recentErrors.map((e) => (
                  <li key={e.id} className="flex items-start gap-2.5 px-4 py-2.5 text-xs">
                    <LevelDot level={e.level} />
                    <span className="min-w-0 flex-1"><span className="line-clamp-2 font-code">{e.message}</span><span className="text-muted-foreground">{SOURCE_LABEL[e.source] || e.source} · {e.count}× · {ago(e.last_at)}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" />No open errors.</p>}
          </section>
          <section className="rounded-xl border border-card-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold">Latest changes</h3>
              <button type="button" onClick={() => go("changes")} className="text-xs font-semibold text-primary">Change log</button>
            </div>
            {data.recentChanges.length ? (
              <ul className="divide-y divide-border">
                {data.recentChanges.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-xs"><span className="line-clamp-2">{c.summary}</span><span className="text-muted-foreground">{c.actor} · {ago(c.at)}</span></li>
                ))}
              </ul>
            ) : <p className="px-4 py-6 text-sm text-muted-foreground">No changes recorded yet. Admin changes show up here as they happen.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Error log
type ErrRow = { id: number; level: string; source: string; message: string; path: string; method: string; status_code: number | null; user_id: number | null; detail: string; count: number; first_at: number; last_at: number; resolved: boolean; resolved_by: string; resolved_at: number | null };
type ErrResp = { rows: ErrRow[]; total: number; facets: { source: Record<string, number>; level: Record<string, number> }; last24h: number; trend: [string, number][] };
const SOURCE_LABEL: Record<string, string> = { server: "Server", api: "API", ai: "AI", client: "Browser", email: "Email", job: "Background" };
const SOURCES = ["all", "api", "server", "ai", "client", "email", "job"];
function LevelDot({ level }: { level: string }) {
  return <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", level === "warn" ? "bg-amber-500" : "bg-red-500")} title={level === "warn" ? "Warning" : "Error"} />;
}
export function ErrorLog({ api }: { api: AdmApi }) {
  const { toast } = useToast();
  const [status, setStatus] = useState("open");
  const [source, setSource] = useState("all");
  const [level, setLevel] = useState("all");
  const [days, setDays] = useState(7);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<Set<number>>(new Set());
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ status, source, level, days: String(days), q: dq, limit: String(limit) }).toString();
  const { data, isLoading, isFetching, refetch } = useQuery<ErrResp>({ queryKey: ["/api/admin/errors", qs], queryFn: api.admGet(`/api/admin/errors?${qs}`), refetchInterval: 30_000 });
  useEffect(() => { setSel(new Set()); setLimit(50); }, [status, source, level, days, dq]);
  const resolve = useMutation({
    mutationFn: async (v: { ids: number[]; reopen?: boolean }) => (await api.adm("POST", "/api/admin/errors/resolve", v)).json() as Promise<{ updated: number }>,
    onSuccess: (r, v) => { setSel(new Set()); queryClient.invalidateQueries({ queryKey: ["/api/admin/errors"] }); queryClient.invalidateQueries({ queryKey: ["/api/admin/overview"] }); toast({ title: `${r.updated} error${r.updated === 1 ? "" : "s"} ${v.reopen ? "reopened" : "resolved"}` }); },
  });
  const rows = data?.rows || [];
  const toggle = (set: Set<number>, id: number) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };
  const fs = data?.facets.source || {};
  const fl = data?.facets.level || {};
  const allOpen = Object.values(fs).reduce((a, b) => a + b, 0);
  const exportCsv = () => {
    const head = ["id", "level", "source", "message", "path", "status", "count", "first_seen", "last_seen", "resolved", "user_id"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.join(","), ...rows.map((r) => [r.id, r.level, r.source, r.message, r.path, r.status_code ?? "", r.count, new Date(r.first_at).toISOString(), new Date(r.last_at).toISOString(), r.resolved, r.user_id ?? ""].map(esc).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `wheelsdown-errors-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  return (
    <div className="space-y-3" data-testid="panel-errors">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Error log</h2>
          <p className="text-xs text-muted-foreground">Server, API, AI and browser errors. Repeats of the same problem are grouped with a count. Kept 90 days.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => refetch()} data-testid="button-errors-refresh">{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</button>
          <button type="button" className={btn} onClick={exportCsv} disabled={!rows.length} data-testid="button-errors-csv"><Download className="h-4 w-4" />CSV</button>
        </div>
      </div>

      {data && data.trend.length > 1 && (
        <div className="h-24 rounded-xl border border-card-border bg-card px-2 pt-2" data-testid="chart-errors">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.trend.map(([d, n]) => ({ d: d.slice(5), n }))} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
              <XAxis dataKey="d" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v, "errors"]} />
              <Bar dataKey="n" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-card-border bg-card p-3" data-testid="filters-errors">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center [&>label]:col-span-2 [&>select]:w-full sm:[&>select]:w-auto">
          <SearchBox value={q} onChange={setQ} placeholder="Search message, path or stack" testId="input-errors-search" />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls} data-testid="select-errors-days">
            {DAYS.map(([d, l]) => <option key={d} value={d}>Last {l}</option>)}
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls} data-testid="select-errors-level">
            <option value="all">Errors and warnings</option><option value="error">Errors only ({fl.error || 0})</option><option value="warn">Warnings only ({fl.warn || 0})</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} data-testid="select-errors-status">
            <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">Open and resolved</option>
          </select>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {SOURCES.map((s) => <Chip key={s} active={source === s} onClick={() => setSource(s)} testId={`chip-errors-${s}`}>{s === "all" ? "All sources" : SOURCE_LABEL[s]}<Count n={s === "all" ? allOpen : fs[s]} /></Chip>)}
        </div>
      </div>

      {sel.size > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/50 bg-card px-3 py-2 shadow-sm" data-testid="bar-errors-selected">
          <span className="text-sm font-semibold">{sel.size} selected</span>
          {status !== "resolved" && <button type="button" className={btnPrimary} onClick={() => resolve.mutate({ ids: Array.from(sel) })} disabled={resolve.isPending} data-testid="button-errors-resolve"><CheckCircle2 className="h-4 w-4" />Resolve</button>}
          {status !== "open" && <button type="button" className={btn} onClick={() => resolve.mutate({ ids: Array.from(sel), reopen: true })} disabled={resolve.isPending} data-testid="button-errors-reopen"><RotateCcw className="h-4 w-4" />Reopen</button>}
          <button type="button" className={btn} onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : !rows.length ? (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="text-errors-empty">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />{q || source !== "all" || level !== "all" ? "No errors match these filters." : status === "open" ? "No open errors. Nice." : "Nothing here."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            <input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} data-testid="check-errors-all" />
            <span className="flex-1">{data?.total} {data?.total === 1 ? "error" : "errors"} · {data?.last24h || 0} in the last 24 h</span>
            <span className="hidden w-16 text-right sm:block">Count</span><span className="hidden w-24 text-right sm:block">Last seen</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const isOpen = open.has(r.id);
              return (
                <li key={r.id} className={cn(r.resolved && "opacity-70")} data-testid={`row-error-${r.id}`}>
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <input type="checkbox" aria-label="Select error" className="mt-1" checked={sel.has(r.id)} onChange={() => setSel((s) => toggle(s, r.id))} data-testid={`check-error-${r.id}`} />
                    <button type="button" onClick={() => setOpen((s) => toggle(s, r.id))} className="flex min-w-0 flex-1 items-start gap-2 text-left" data-testid={`button-error-${r.id}`}>
                      {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                      <LevelDot level={r.level} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block font-code text-[13px] leading-snug", !isOpen && "line-clamp-2")}>{r.message}</span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                          <span className="font-semibold">{SOURCE_LABEL[r.source] || r.source}</span>
                          {r.path && <span className="font-code">{r.method ? `${r.method} ` : ""}{r.path}</span>}
                          {r.status_code ? <span>HTTP {r.status_code}</span> : null}
                          <span className="sm:hidden">{r.count}× · {ago(r.last_at)}</span>
                          {r.resolved && <span className="text-emerald-700 dark:text-emerald-400">Resolved{r.resolved_by ? ` by ${r.resolved_by}` : ""}{r.resolved_at ? ` · ${ago(r.resolved_at)}` : ""}</span>}
                        </span>
                      </span>
                    </button>
                    <span className="hidden w-16 text-right font-code text-sm font-semibold tabular sm:block">{r.count}×</span>
                    <span className="hidden w-24 text-right text-xs text-muted-foreground sm:block" title={stamp(r.last_at)}>{ago(r.last_at)}</span>
                  </div>
                  {isOpen && (
                    <div className="space-y-2 border-t border-dashed border-border bg-muted/30 px-4 py-3 text-xs" data-testid={`detail-error-${r.id}`}>
                      <p className="text-muted-foreground">First seen {stamp(r.first_at)} · last seen {stamp(r.last_at)}{r.user_id ? <> · user <a className="font-semibold text-foreground underline" href={`#/crew/${r.user_id}`}>#{r.user_id}</a></> : ""}</p>
                      {r.detail ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-2.5 font-code text-[11px] leading-relaxed">{r.detail}</pre> : <p className="text-muted-foreground">No stack trace recorded.</p>}
                      <div className="flex gap-2">
                        {r.resolved
                          ? <button type="button" className={btn} onClick={() => resolve.mutate({ ids: [r.id], reopen: true })} data-testid={`button-error-reopen-${r.id}`}><RotateCcw className="h-4 w-4" />Reopen</button>
                          : <button type="button" className={btnPrimary} onClick={() => resolve.mutate({ ids: [r.id] })} data-testid={`button-error-resolve-${r.id}`}><CheckCircle2 className="h-4 w-4" />Resolve</button>}
                        <button type="button" className={btn} onClick={() => { navigator.clipboard?.writeText(`${r.message}\n${r.path}\n${r.detail}`); toast({ title: "Copied" }); }}>Copy</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {data && data.total > rows.length && (
            <button type="button" onClick={() => setLimit((l) => l + 50)} className="w-full border-t border-border py-2.5 text-xs font-semibold text-primary hover-elevate" data-testid="button-errors-more">Show more ({data.total - rows.length} more)</button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Change log
type ChangeRow = { key: string; at: number; kind: string; actor: string; action: string; entity: string; entity_id: string; summary: string; detail: string };
type ChangeResp = { rows: ChangeRow[]; total: number; facets: { kind: Record<string, number>; entity: Record<string, number>; actor: Record<string, number> } };
const KIND_LABEL: Record<string, string> = { admin: "Admin", moderation: "Moderation", points: "Points", ai: "AI", release: "Release", system: "System" };
const KIND_TONE: Record<string, string> = {
  admin: "bg-primary/15 text-foreground", moderation: "bg-sky-500/15 text-sky-800 dark:text-sky-300", points: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  ai: "bg-violet-500/15 text-violet-800 dark:text-violet-300", release: "bg-foreground text-background", system: "bg-muted text-muted-foreground",
};
const ENTITY_LABEL: Record<string, string> = { spot: "Listings", review: "Ratings", user: "Crew", feedback: "Feedback", ad: "Ads", ai_pick: "AI picks", moderation: "Moderation", setting: "Settings", release: "Releases", error: "Errors" };
function prettyDetail(d: string) {
  if (!d) return "";
  try { return JSON.stringify(JSON.parse(d), (_k, v) => { if (typeof v === "string" && /^[[{]/.test(v)) { try { return JSON.parse(v); } catch { return v; } } return v; }, 2); } catch { return d; }
}
export function ChangeLog({ api }: { api: AdmApi }) {
  const [kind, setKind] = useState("all");
  const [entity, setEntity] = useState("all");
  const [actor, setActor] = useState("all");
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState(false);
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ kind, entity, actor, days: String(days), q: dq, limit: String(limit) }).toString();
  const { data, isLoading } = useQuery<ChangeResp>({ queryKey: ["/api/admin/changes", qs], queryFn: api.admGet(`/api/admin/changes?${qs}`), refetchInterval: 60_000 });
  useEffect(() => setLimit(50), [kind, entity, actor, days, dq]);
  const rows = data?.rows || [];
  const fk = data?.facets.kind || {};
  const total = Object.values(fk).reduce((a, b) => a + b, 0);
  const byDay = useMemo(() => {
    const m: [string, ChangeRow[]][] = [];
    for (const r of rows) {
      const d = new Date(r.at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      const last = m[m.length - 1];
      if (last && last[0] === d) last[1].push(r); else m.push([d, [r]]);
    }
    return m;
  }, [rows]);
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [["when", "type", "who", "action", "item", "id", "summary"].join(","), ...rows.map((r) => [new Date(r.at).toISOString(), r.kind, r.actor, r.action, r.entity, r.entity_id, r.summary].map(esc).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `wheelsdown-change-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  return (
    <div className="space-y-3" data-testid="panel-changes">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Change log</h2>
          <p className="text-xs text-muted-foreground">Every admin change, moderation decision (AI, admins and owners), bonus points, AI pick event and release, newest first.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => setNotes(!notes)} aria-expanded={notes} data-testid="button-release-notes"><Sparkles className="h-4 w-4" />Release notes</button>
          <button type="button" className={btn} onClick={exportCsv} disabled={!rows.length} data-testid="button-changes-csv"><Download className="h-4 w-4" />CSV</button>
        </div>
      </div>

      {notes && (
        <ol className="space-y-3 rounded-xl border border-card-border bg-card p-4" data-testid="list-release-notes">
          {RELEASES.map((r, i) => (
            <li key={i} className="grid gap-1 sm:grid-cols-[110px_1fr]">
              <p className="text-xs text-muted-foreground">{new Date(r.date + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}{r.sha && <span className="block font-code">{r.sha}</span>}</p>
              <div>
                <p className="text-sm font-semibold">{r.title}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{r.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="space-y-2 rounded-xl border border-card-border bg-card p-3" data-testid="filters-changes">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center [&>label]:col-span-2 [&>select]:w-full sm:[&>select]:w-auto">
          <SearchBox value={q} onChange={setQ} placeholder="Search summary, person, or #id" testId="input-changes-search" />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls} data-testid="select-changes-days">
            {[...DAYS, [400, "year"] as [number, string]].map(([d, l]) => <option key={d} value={d}>Last {l}</option>)}
          </select>
          <select value={entity} onChange={(e) => setEntity(e.target.value)} className={inputCls} data-testid="select-changes-entity">
            <option value="all">All items</option>
            {Object.entries(data?.facets.entity || {}).map(([k, n]) => <option key={k} value={k}>{ENTITY_LABEL[k] || k} ({n})</option>)}
          </select>
          <select value={actor} onChange={(e) => setActor(e.target.value)} className={inputCls} data-testid="select-changes-actor">
            <option value="all">Anyone</option>
            {Object.entries(data?.facets.actor || {}).map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
          </select>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {["all", "admin", "moderation", "points", "ai", "release", "system"].map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)} testId={`chip-changes-${k}`}>{k === "all" ? "Everything" : KIND_LABEL[k]}<Count n={k === "all" ? total : fk[k]} /></Chip>
          ))}
        </div>
      </div>

      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : !rows.length ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="text-changes-empty">No changes match these filters.</p>
      ) : (
        <div className="space-y-4">
          {byDay.map(([d, list]) => (
            <section key={d}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{d}</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-card-border bg-card">
                {list.map((r) => {
                  const isOpen = open.has(r.key);
                  const det = isOpen ? prettyDetail(r.detail) : "";
                  return (
                    <li key={r.key} data-testid={`row-change-${r.key}`}>
                      <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover-elevate">
                        <span className="w-14 shrink-0 pt-0.5 text-[11px] text-muted-foreground tabular">{new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", KIND_TONE[r.kind] || KIND_TONE.system)}>{KIND_LABEL[r.kind] || r.kind}</span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-sm", !isOpen && "line-clamp-2")}>{r.summary}</span>
                          <span className="text-[11px] text-muted-foreground">{r.actor}{r.entity ? ` · ${ENTITY_LABEL[r.entity] || r.entity}${r.entity_id ? ` #${r.entity_id}` : ""}` : ""}</span>
                        </span>
                        {r.detail && (isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />)}
                      </button>
                      {isOpen && det && <pre className="mx-3 mb-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-2.5 font-code text-[11px]" data-testid={`detail-change-${r.key}`}>{det}</pre>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {data && data.total > rows.length && (
            <button type="button" onClick={() => setLimit((l) => l + 50)} className={cn(btn, "w-full justify-center")} data-testid="button-changes-more">Show more ({data.total - rows.length} more)</button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- AI picks
type AiRow = { id: number; icao: string; category: string; meal: string; name: string; address: string; website: string; description: string; miles: number | null; status: string; focus: string; spotId: number | null; bonusUserId: number | null; createdAt: number };
type AiResp = { enabled: boolean; rows: AiRow[]; states: Record<string, { status: string; at: number } | null>; cap: number; usedToday: number };
const CAT_LABEL: Record<string, string> = { eat: "Eat", do: "Do", stay: "Stay" };
export function AiPicksAdmin({ api }: { api: AdmApi }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState("live");
  const [airport, setAirport] = useState<string | null>(null);
  const { data, isLoading } = useQuery<AiResp>({ queryKey: ["/api/admin/ai-picks"], queryFn: api.admGet("/api/admin/ai-picks"), refetchInterval: 30_000 });
  const inv = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-picks"] });
  const hide = useMutation({ mutationFn: async (v: { id: number; hidden: boolean }) => (await api.adm("POST", `/api/admin/ai-picks/${v.id}/hide`, { hidden: v.hidden })).json(), onSuccess: inv });
  const refresh = useMutation({
    mutationFn: async (icao: string) => (await api.adm("POST", "/api/admin/ai-picks/refresh", { icao })).json() as Promise<{ status: string }>,
    onSuccess: (r, icao) => { inv(); toast({ title: r.status === "pending" ? `Refreshing ${icao}` : `${icao}: ${r.status}`, description: r.status === "pending" ? "New picks replace the current ones in a minute or two. Picks crews added to briefs stay." : undefined }); },
  });
  const all = data?.rows || [];
  const airports = useMemo(() => {
    const m = new Map<string, { live: number; hidden: number; claimed: number; bonus: number }>();
    for (const r of all) {
      const a = m.get(r.icao) || { live: 0, hidden: 0, claimed: 0, bonus: 0 };
      if (r.status === "live") a.live++; else if (r.status === "hidden") a.hidden++;
      if (r.spotId) a.claimed++; if (r.bonusUserId) a.bonus++;
      m.set(r.icao, a);
    }
    for (const k of Object.keys(data?.states || {})) if (!m.has(k)) m.set(k, { live: 0, hidden: 0, claimed: 0, bonus: 0 });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [all, data?.states]);
  const term = q.trim().toLowerCase();
  const rows = all.filter((r) => (!airport || r.icao === airport) && (cat === "all" || r.category === cat)
    && (status === "all" || (status === "claimed" ? !!r.spotId : r.status === status))
    && (!term || r.name.toLowerCase().includes(term) || r.icao.toLowerCase().includes(term) || r.address.toLowerCase().includes(term)));
  const stateOf = (icao: string) => data?.states?.[icao];
  return (
    <div className="space-y-3" data-testid="panel-aipicks">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">AI picks</h2>
          <p className="text-xs text-muted-foreground">Places AI suggested where crews haven't listed anything. Separate from crew listings and rankings; the only points are the one-time +10 for the first crew member to rate one that was added as a listing. {data ? `${data.usedToday} of ${data.cap} airport runs used today.` : ""}</p>
        </div>
        {data && !data.enabled && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">AI is off on this server</span>}
      </div>
      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : (
        <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-xl border border-card-border bg-card" data-testid="list-ai-airports">
            <button type="button" onClick={() => setAirport(null)} className={cn("flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm hover-elevate", !airport && "font-semibold")}>
              All airports <span className="font-code text-xs tabular text-muted-foreground">{airports.length}</span>
            </button>
            <ul className="max-h-[28rem] overflow-y-auto divide-y divide-border">
              {airports.map(([icao, a]) => {
                const st = stateOf(icao);
                return (
                  <li key={icao} className={cn("flex items-center gap-2 px-3 py-2", airport === icao && "bg-muted/60")}>
                    <button type="button" onClick={() => setAirport(airport === icao ? null : icao)} className="min-w-0 flex-1 text-left" data-testid={`button-ai-airport-${icao}`}>
                      <span className="font-code text-sm font-bold">{icao}</span>
                      <span className="block text-[11px] text-muted-foreground">{a.live} live{a.hidden ? ` · ${a.hidden} hidden` : ""}{a.claimed ? ` · ${a.claimed} added` : ""}{st?.status === "failed" ? " · last run failed" : st?.status === "pending" ? " · running" : ""}</span>
                    </button>
                    <button type="button" onClick={() => refresh.mutate(icao)} disabled={refresh.isPending} aria-label={`Refresh ${icao}`} title="Replace with fresh picks" className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover-elevate" data-testid={`button-ai-refresh-${icao}`}>
                      {st?.status === "pending" ? <Loader2 className="h-4 w-4 animate-spin" /> : st?.status === "failed" ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-card p-3">
              <SearchBox value={q} onChange={setQ} placeholder="Search name, airport or address" testId="input-ai-search" />
              <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls} data-testid="select-ai-cat"><option value="all">All categories</option><option value="eat">Eat</option><option value="do">Do</option><option value="stay">Stay</option></select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} data-testid="select-ai-status"><option value="live">Live</option><option value="hidden">Hidden</option><option value="claimed">Added by crews</option><option value="all">All</option></select>
            </div>
            {!rows.length ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No AI picks match.</p> : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-card-border bg-card">
                {rows.slice(0, 300).map((r) => (
                  <li key={r.id} className={cn("flex items-start gap-3 px-3 py-2.5", r.status === "hidden" && "opacity-60")} data-testid={`row-ai-${r.id}`}>
                    <span className="mt-0.5 w-12 shrink-0 font-code text-xs font-bold">{r.icao}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{r.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {CAT_LABEL[r.category]}{r.meal ? ` · ${r.meal}` : ""}{r.miles != null ? ` · ${r.miles} mi` : ""}{r.focus ? ` · asked for ${r.focus === "local" ? "local favorites" : cuisineLabel(r.focus)}` : ""} · {ago(r.createdAt)}
                      </span>
                      {r.description && <span className="block text-[11px] text-muted-foreground line-clamp-1">{r.description}</span>}
                      {(r.spotId || r.bonusUserId) && (
                        <span className="mt-0.5 block text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          {r.spotId && <a href={`#/spot/${r.spotId}`} className="underline">Added as listing #{r.spotId}</a>}{r.bonusUserId ? <> · +10 to <a href={`#/crew/${r.bonusUserId}`} className="underline">user #{r.bonusUserId}</a></> : r.spotId ? " · bonus waits for the first rating" : ""}
                        </span>
                      )}
                    </span>
                    {r.status !== "claimed" && (
                      <button type="button" className={btn} onClick={() => hide.mutate({ id: r.id, hidden: r.status !== "hidden" })} disabled={hide.isPending} data-testid={`button-ai-hide-${r.id}`}>
                        {r.status === "hidden" ? <><Eye className="h-4 w-4" />Show</> : <><EyeOff className="h-4 w-4" />Hide</>}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {rows.length > 300 && <p className="text-center text-xs text-muted-foreground">Showing 300 of {rows.length}. Narrow by airport or search.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
