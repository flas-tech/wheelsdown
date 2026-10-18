// Crew Lounge: discussion board for crews. Admins only until the launch switch opens it (lounge_audience = members);
// also shown as a tab in the admin console for super-user accounts.
import { usePreviewState } from "@/lib/experience";
import NotFound from "@/pages/not-found";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, EyeOff, Eye, Flag, Lock, LockOpen, MessageSquare, Pencil, Pin, PinOff, Plus, Search, ThumbsUp, Trash2, TriangleAlert, Loader2, Shield, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth, TierChip } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { findTailNumbers, TAIL_RULE } from "@shared/tailNumber";
import {
  LOUNGE_CATEGORIES, LOUNGE_LIMITS, LOUNGE_OPS_DISCLAIMER, LOUNGE_REPORT_REASONS, loungeCategoryLabel,
  type LoungeAuthor, type LoungeCategoryId, type LoungePost, type LoungeThread,
} from "@shared/lounge";
import type { TierId } from "@shared/tiers";

const inputCls = "w-full h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const areaCls = "w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring";
const btn = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-medium border border-border bg-card hover-elevate disabled:opacity-50";
const btnSm = "inline-flex items-center gap-1 h-7 rounded-md px-2 text-xs font-medium border border-border bg-card hover-elevate disabled:opacity-50";
const btnPrimary = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-semibold taxi-sign hover-elevate disabled:opacity-50";

type ListResp = {
  audience: "admins" | "members"; moderator: boolean; threads: LoungeThread[]; reports: number;
  categories: { id: LoungeCategoryId; label: string; blurb: string; count: number }[];
  me: { anonymous: boolean; helpful: number; points: number; countsTowardStatus: boolean };
};
type ThreadResp = { thread: LoungeThread; posts: LoungePost[]; moderator: boolean };

/** "422: {...json...}" -> the server's message */
const errMsg = (e: unknown) => { const s = String((e as any)?.message || e); const j = s.replace(/^\d+:\s*/, ""); try { return JSON.parse(j).message || j; } catch { return j; } };
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return "just now"; if (m < 60) return `${m}m`; const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  const d = Math.round(h / 24); return d < 30 ? `${d}d` : new Date(t).toLocaleDateString();
};
const refreshList = () => queryClient.invalidateQueries({ queryKey: ["/api/lounge"] });

export function LoungePanel() {
  const [view, setView] = useState<{ kind: "list" } | { kind: "thread"; id: number } | { kind: "new" } | { kind: "reports" }>({ kind: "list" });
  const [cat, setCat] = useState<LoungeCategoryId | "">("");
  const [q, setQ] = useState("");
  const [airport, setAirport] = useState("");
  const [sort, setSort] = useState<"active" | "new" | "top">("active");
  const params = new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(airport.trim() ? { airport: airport.trim() } : {}), sort }).toString();
  const { data, isLoading, error } = useQuery<ListResp>({ queryKey: ["/api/lounge", `?${params}`], queryFn: async () => (await apiRequest("GET", `/api/lounge?${params}`)).json(), staleTime: 15_000 });

  if (error) return <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-lounge-error">Sign in to use the Crew Lounge. {errMsg(error)}</p>;
  const open = data?.audience === "members";

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="panel-lounge">
      <div className="rounded-2xl bg-[#0B1222] px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{open ? "Talk shop" : "Preview · admins only"}</p>
            <h2 className="text-lg font-semibold">Crew Lounge</h2>
            <p className="mt-0.5 text-xs text-white/70">{open ? "Ask other crews, share what you know. Helpful answers earn Lounge points." : "Members can't see this yet."}</p>
          </div>
          {data && (
            <div className="text-left text-xs text-white/80 sm:text-right" data-testid="text-lounge-points">
              <p><span className="font-code text-base font-bold text-white tabular">{data.me.helpful}</span> helpful votes from others</p>
              <p>{data.me.points} Lounge points{data.me.countsTowardStatus ? "" : " (join your status at launch)"}</p>
            </div>
          )}
        </div>
      </div>

      {view.kind === "list" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimary} onClick={() => setView({ kind: "new" })} data-testid="button-lounge-new"><Plus className="h-4 w-4" />New thread</button>
            {data?.moderator && (
              <button className={btn} onClick={() => setView({ kind: "reports" })} data-testid="button-lounge-reports">
                <Flag className="h-4 w-4" />Reports{data.reports ? <span className="ml-0.5 rounded-full bg-destructive px-1.5 font-code text-[10px] font-bold text-destructive-foreground">{data.reports}</span> : null}
              </button>
            )}
          </div>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categories">
            <Chip on={!cat} onClick={() => setCat("")} testid="chip-lounge-all">All</Chip>
            {(data?.categories || LOUNGE_CATEGORIES.map((c) => ({ ...c, count: 0 }))).map((c) => (
              <Chip key={c.id} on={cat === c.id} onClick={() => setCat(c.id)} testid={`chip-lounge-${c.id}`} title={c.blurb}>{c.label}{c.count ? <span className="ml-1 opacity-60 tabular">{c.count}</span> : null}</Chip>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem]">
            <label className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search threads" className={inputCls + " pl-8"} data-testid="input-lounge-search" /></label>
            <input value={airport} onChange={(e) => setAirport(e.target.value.toUpperCase())} placeholder="Airport" maxLength={4} className={inputCls + " font-code uppercase"} data-testid="input-lounge-airport" />
            <select value={sort} onChange={(e) => setSort(e.target.value as any)} className={inputCls} data-testid="select-lounge-sort">
              <option value="active">Most active</option><option value="new">Newest</option><option value="top">Most helpful</option>
            </select>
          </div>
          {isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div> : (
            <ul className="space-y-2" data-testid="list-lounge-threads">
              {data!.threads.length === 0 && <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No threads here yet. Start one.</li>}
              {data!.threads.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setView({ kind: "thread", id: t.id })} className={cn("w-full rounded-xl border border-card-border bg-card p-3 text-left hover-elevate", t.status === "hidden" && "opacity-60")} data-testid={`row-lounge-thread-${t.id}`}>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t.pinned && <Pin className="h-3 w-3 text-primary" />}{t.locked && <Lock className="h-3 w-3" />}
                      <span>{loungeCategoryLabel(t.category)}</span>
                      {t.airports.map((a) => <span key={a} className="rounded bg-muted px-1 font-code text-foreground">{a}</span>)}
                      {t.status === "hidden" && <span className="rounded bg-destructive/15 px-1 text-destructive">Hidden</span>}
                      {!!t.openReports && <span className="rounded bg-destructive px-1 text-destructive-foreground">{t.openReports} report{t.openReports > 1 ? "s" : ""}</span>}
                    </div>
                    <p className="mt-1 text-sm font-semibold leading-snug">{t.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <AuthorLine a={t.author} />
                      <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{t.replyCount}</span>
                      <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{t.helpful}</span>
                      <span>{ago(t.lastActivityAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {view.kind === "new" && <Composer anonDefault={!!data?.me.anonymous} defaultCat={cat || "hangar"} onDone={(id) => { refreshList(); setView(id ? { kind: "thread", id } : { kind: "list" }); }} />}
      {view.kind === "thread" && <ThreadView id={view.id} anonDefault={!!data?.me.anonymous} onBack={() => { refreshList(); setView({ kind: "list" }); }} />}
      {view.kind === "reports" && <ReportsView onBack={() => { refreshList(); setView({ kind: "list" }); }} onOpen={(id) => setView({ kind: "thread", id })} />}
    </div>
  );
}

function Chip({ on, onClick, children, testid, title }: { on: boolean; onClick: () => void; children: React.ReactNode; testid: string; title?: string }) {
  return <button onClick={onClick} title={title} role="tab" aria-selected={on} className={cn("h-8 shrink-0 rounded-full border px-3 text-xs font-semibold", on ? "taxi-sign border-transparent" : "border-border bg-card hover-elevate")} data-testid={testid}>{children}</button>;
}

function AuthorLine({ a }: { a: LoungeAuthor }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="text-lounge-author">
      {a.house ? <Shield className="h-3 w-3 text-primary" /> : null}
      <span className="font-medium text-foreground">{a.name}</span>
      {!a.house && <span>· {a.crewRole}</span>}
      {a.tierId && <TierChip tierId={a.tierId as TierId} />}
      {a.realName && <span className="rounded bg-muted px-1 text-[10px]" title="Only admins see who posted anonymously">Admin view: {a.realName}</span>}
    </span>
  );
}

/** Live tail-number check while typing: the same rule the server enforces. */
function useTails(...texts: string[]) {
  return useMemo(() => Array.from(new Set(texts.flatMap((t) => findTailNumbers(t)).map((h) => h.text))), [texts.join("\u0000")]); // eslint-disable-line
}
function TailWarning({ tails }: { tails: string[] }) {
  if (!tails.length) return null;
  return (
    <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive" data-testid="alert-tail-number">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div><p className="font-semibold">Tail number not allowed: {tails.map((t) => <span key={t} className="mx-0.5 rounded bg-destructive/15 px-1 font-code">{t}</span>)}</p><p className="mt-0.5">{TAIL_RULE}</p></div>
    </div>
  );
}

function AnonToggle({ value, onChange, id }: { value: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Switch id={id} checked={value} onCheckedChange={onChange} data-testid={`switch-${id}`} />Post anonymously
    </label>
  );
}

function Composer({ anonDefault, defaultCat, onDone }: { anonDefault: boolean; defaultCat: LoungeCategoryId; onDone: (id?: number) => void }) {
  const { toast } = useToast();
  const [category, setCategory] = useState<LoungeCategoryId>(defaultCat);
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [airports, setAirports] = useState("");
  const [anonymous, setAnonymous] = useState(anonDefault); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const tails = useTails(title, body);
  const ok = title.trim().length >= LOUNGE_LIMITS.title[0] && body.trim().length >= 1 && !tails.length;
  return (
    <form className="space-y-3 rounded-2xl border border-card-border bg-card p-4" data-testid="form-lounge-new"
      onSubmit={async (e) => {
        e.preventDefault(); if (!ok) return; setBusy(true); setErr("");
        try { const r = await (await apiRequest("POST", "/api/lounge/threads", { category, title, body, airports, anonymous })).json(); toast({ title: "Thread posted" }); onDone(r.id); }
        catch (x) { setErr(errMsg(x)); }
        setBusy(false);
      }}>
      <div className="flex items-center justify-between"><h3 className="text-base font-semibold">New thread</h3><button type="button" className={btnSm} onClick={() => onDone()}>Cancel</button></div>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <select value={category} onChange={(e) => setCategory(e.target.value as LoungeCategoryId)} className={inputCls} data-testid="select-lounge-category">
          {LOUNGE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}: {c.blurb}</option>)}
        </select>
        <input value={airports} onChange={(e) => setAirports(e.target.value.toUpperCase())} placeholder="Airports (optional)" className={inputCls + " font-code uppercase"} data-testid="input-lounge-airports" />
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LOUNGE_LIMITS.title[1]} placeholder="Title" className={inputCls + " h-10 font-semibold"} data-testid="input-lounge-title" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={LOUNGE_LIMITS.body[1]} rows={7} placeholder="What's on your mind? Describe aircraft by type, never by tail number." className={areaCls} data-testid="input-lounge-body" />
      {category === "airport-ops" && <p className="text-xs text-muted-foreground">{LOUNGE_OPS_DISCLAIMER}</p>}
      <TailWarning tails={tails} />
      {err && <p className="text-sm text-destructive" data-testid="text-lounge-post-error">{err}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AnonToggle id="lounge-anon-thread" value={anonymous} onChange={setAnonymous} />
        <button disabled={!ok || busy} className={btnPrimary} data-testid="button-lounge-post">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Post thread</button>
      </div>
    </form>
  );
}

function HelpfulButton({ type, id, count, voted, disabled, onChange }: { type: "thread" | "post"; id: number; count: number; voted: boolean; disabled: boolean; onChange: () => void }) {
  const { toast } = useToast();
  return (
    <button className={cn(btnSm, voted && "border-primary bg-primary/15")} disabled={disabled} title={disabled ? "You can't mark your own post helpful" : "Helpful (2 points to the author)"}
      onClick={async () => { try { await apiRequest("POST", `/api/lounge/${type}/${id}/helpful`, { on: !voted }); onChange(); } catch (e) { toast({ title: errMsg(e) }); } }}
      data-testid={`button-helpful-${type}-${id}`} aria-pressed={voted}>
      <ThumbsUp className="h-3 w-3" />Helpful{count ? <span className="tabular"> {count}</span> : null}
    </button>
  );
}

function ReportButton({ type, id }: { type: "thread" | "post"; id: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  if (!open) return <button className={btnSm} onClick={() => setOpen(true)} data-testid={`button-report-${type}-${id}`}><Flag className="h-3 w-3" />Report</button>;
  return (
    <select autoFocus className="h-7 rounded-md border border-input bg-background px-1 text-xs" defaultValue="" data-testid={`select-report-${type}-${id}`}
      onBlur={() => setOpen(false)}
      onChange={async (e) => { const reason = e.target.value; setOpen(false); if (!reason) return; try { await apiRequest("POST", `/api/lounge/${type}/${id}/report`, { reason }); toast({ title: "Reported. Thanks for flagging it." }); } catch (x) { toast({ title: errMsg(x) }); } }}>
      <option value="" disabled>Why?</option>
      {LOUNGE_REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}
    </select>
  );
}

function ThreadView({ id, anonDefault, onBack }: { id: number; anonDefault: boolean; onBack: () => void }) {
  const { me } = useAuth();
  const { toast } = useToast();
  const key = ["/api/lounge/threads", String(id)];
  const { data, isLoading, error, refetch } = useQuery<ThreadResp>({ queryKey: key, queryFn: async () => (await apiRequest("GET", `/api/lounge/threads/${id}`)).json(), staleTime: 0 });
  const [reply, setReply] = useState(""); const [anonymous, setAnonymous] = useState(anonDefault); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [editing, setEditing] = useState<{ type: "thread" | "post"; id: number; title?: string; body: string } | null>(null);
  const replyTails = useTails(reply);
  const editTails = useTails(editing?.title || "", editing?.body || "");
  const patch = async (type: "threads" | "posts", tid: number, body: unknown, done?: string) => {
    try { await apiRequest("PATCH", `/api/lounge/${type}/${tid}`, body); if (done) toast({ title: done }); await refetch(); return true; }
    catch (e) { toast({ title: errMsg(e) }); return false; }
  };

  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error || !data) return <div className="space-y-2"><button className={btn} onClick={onBack}><ArrowLeft className="h-4 w-4" />All threads</button><p className="text-sm text-muted-foreground">{errMsg(error)}</p></div>;
  const t = data.thread, mod = data.moderator;

  return (
    <div className="space-y-3" data-testid={`view-lounge-thread-${t.id}`}>
      <button className={btn} onClick={onBack} data-testid="button-lounge-back"><ArrowLeft className="h-4 w-4" />All threads</button>
      <article className={cn("rounded-2xl border border-card-border bg-card p-4", t.status === "hidden" && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t.pinned && <Pin className="h-3 w-3 text-primary" />}{t.locked && <Lock className="h-3 w-3" />}
          <span>{loungeCategoryLabel(t.category)}</span>
          {t.airports.map((a) => <span key={a} className="rounded bg-muted px-1 font-code text-foreground">{a}</span>)}
          {t.status === "hidden" && <span className="rounded bg-destructive/15 px-1 text-destructive">Hidden from members</span>}
        </div>
        {editing?.type === "thread" ? (
          <div className="mt-2 space-y-2">
            <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={LOUNGE_LIMITS.title[1]} className={inputCls + " font-semibold"} data-testid="input-lounge-edit-title" />
            <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={6} maxLength={LOUNGE_LIMITS.body[1]} className={areaCls} data-testid="input-lounge-edit-body" />
            <TailWarning tails={editTails} />
            <div className="flex gap-2"><button className={btnPrimary} disabled={!!editTails.length} onClick={async () => { if (await patch("threads", t.id, { title: editing.title, body: editing.body }, "Saved")) setEditing(null); }} data-testid="button-lounge-save">Save</button><button className={btn} onClick={() => setEditing(null)}>Cancel</button></div>
          </div>
        ) : (
          <>
            <h3 className="mt-1 text-lg font-semibold leading-snug" data-testid="text-lounge-title">{t.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><AuthorLine a={t.author} /><span>· {ago(t.createdAt)}{t.editedAt ? " · edited" : ""}</span></div>
            {t.category === "airport-ops" && <p className="mt-3 rounded-lg bg-primary/10 p-2 text-xs" data-testid="text-lounge-ops-disclaimer">{LOUNGE_OPS_DISCLAIMER}</p>}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-lounge-body">{t.body}</p>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <HelpfulButton type="thread" id={t.id} count={t.helpful} voted={t.votedHelpful} disabled={t.mine} onChange={() => refetch()} />
          {!t.mine && <ReportButton type="thread" id={t.id} />}
          {(t.mine || mod) && !editing && <button className={btnSm} onClick={() => setEditing({ type: "thread", id: t.id, title: t.title, body: t.body })} data-testid="button-lounge-edit"><Pencil className="h-3 w-3" />Edit</button>}
          {(t.mine || mod) && <button className={btnSm} onClick={async () => { if (confirm("Delete this thread and its replies for everyone?") && (await patch("threads", t.id, { delete: true }, "Thread deleted"))) onBack(); }} data-testid="button-lounge-delete"><Trash2 className="h-3 w-3" />Delete</button>}
          {mod && <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <button className={btnSm} onClick={() => patch("threads", t.id, { pinned: !t.pinned })} data-testid="button-lounge-pin">{t.pinned ? <><PinOff className="h-3 w-3" />Unpin</> : <><Pin className="h-3 w-3" />Pin</>}</button>
            <button className={btnSm} onClick={() => patch("threads", t.id, { locked: !t.locked })} data-testid="button-lounge-lock">{t.locked ? <><LockOpen className="h-3 w-3" />Unlock</> : <><Lock className="h-3 w-3" />Lock</>}</button>
            <button className={btnSm} onClick={() => patch("threads", t.id, { status: t.status === "hidden" ? "live" : "hidden" })} data-testid="button-lounge-hide">{t.status === "hidden" ? <><Eye className="h-3 w-3" />Restore</> : <><EyeOff className="h-3 w-3" />Hide</>}</button>
          </>}
        </div>
      </article>

      <h4 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{data.posts.length} {data.posts.length === 1 ? "reply" : "replies"}</h4>
      <ul className="space-y-2">
        {data.posts.map((p) => (
          <li key={p.id} className={cn("rounded-xl border border-card-border bg-card p-3", p.status === "hidden" && "opacity-60")} data-testid={`row-lounge-post-${p.id}`}>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <AuthorLine a={p.author} /><span>· {ago(p.createdAt)}{p.editedAt ? " · edited" : ""}</span>
              {p.status === "hidden" && <span className="rounded bg-destructive/15 px-1 text-destructive">Hidden</span>}
              {!!p.openReports && <span className="rounded bg-destructive px-1 text-destructive-foreground">{p.openReports} report{p.openReports > 1 ? "s" : ""}</span>}
            </div>
            {editing?.type === "post" && editing.id === p.id ? (
              <div className="mt-2 space-y-2">
                <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={4} maxLength={LOUNGE_LIMITS.reply[1]} className={areaCls} />
                <TailWarning tails={editTails} />
                <div className="flex gap-2"><button className={btnPrimary} disabled={!!editTails.length} onClick={async () => { if (await patch("posts", p.id, { body: editing.body }, "Saved")) setEditing(null); }}>Save</button><button className={btn} onClick={() => setEditing(null)}>Cancel</button></div>
              </div>
            ) : <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{p.body}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <HelpfulButton type="post" id={p.id} count={p.helpful} voted={p.votedHelpful} disabled={p.mine} onChange={() => refetch()} />
              {!p.mine && <ReportButton type="post" id={p.id} />}
              {(p.mine || mod) && !editing && <button className={btnSm} onClick={() => setEditing({ type: "post", id: p.id, body: p.body })}><Pencil className="h-3 w-3" />Edit</button>}
              {(p.mine || mod) && <button className={btnSm} onClick={() => { if (confirm("Delete this reply?")) patch("posts", p.id, { delete: true }, "Reply deleted"); }}><Trash2 className="h-3 w-3" />Delete</button>}
              {mod && !p.mine && <button className={btnSm} onClick={() => patch("posts", p.id, { status: p.status === "hidden" ? "live" : "hidden" })}>{p.status === "hidden" ? <><Eye className="h-3 w-3" />Restore</> : <><EyeOff className="h-3 w-3" />Hide</>}</button>}
            </div>
          </li>
        ))}
      </ul>

      {t.locked && !mod ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground"><Lock className="h-4 w-4" />This thread is locked.</p>
      ) : (
        <form className="space-y-2 rounded-2xl border border-card-border bg-card p-3" data-testid="form-lounge-reply"
          onSubmit={async (e) => {
            e.preventDefault(); if (!reply.trim() || replyTails.length) return; setBusy(true); setErr("");
            try { await apiRequest("POST", `/api/lounge/threads/${t.id}/posts`, { body: reply, anonymous }); setReply(""); await refetch(); }
            catch (x) { setErr(errMsg(x)); }
            setBusy(false);
          }}>
          {t.locked && <p className="text-xs text-muted-foreground">Locked for members. As an admin you can still reply.</p>}
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={LOUNGE_LIMITS.reply[1]} placeholder={me ? "Add a reply" : "Sign in to reply"} className={areaCls} data-testid="input-lounge-reply" />
          <TailWarning tails={replyTails} />
          {err && <p className="text-sm text-destructive" data-testid="text-lounge-reply-error">{err}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AnonToggle id="lounge-anon-reply" value={anonymous} onChange={setAnonymous} />
            <button disabled={!reply.trim() || !!replyTails.length || busy} className={btnPrimary} data-testid="button-lounge-reply">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Reply</button>
          </div>
        </form>
      )}
    </div>
  );
}

function ReportsView({ onBack, onOpen }: { onBack: () => void; onOpen: (threadId: number) => void }) {
  const { data, isLoading, refetch } = useQuery<any[]>({ queryKey: ["/api/lounge/reports"], queryFn: async () => (await apiRequest("GET", "/api/lounge/reports")).json(), staleTime: 0 });
  return (
    <div className="space-y-3" data-testid="view-lounge-reports">
      <button className={btn} onClick={onBack}><ArrowLeft className="h-4 w-4" />All threads</button>
      <h3 className="text-base font-semibold">Open reports</h3>
      {isLoading ? <Skeleton className="h-24 rounded-xl" /> : !data?.length ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing reported.</p> : (
        <ul className="space-y-2">
          {data.map((r) => (
            <li key={r.id} className="rounded-xl border border-card-border bg-card p-3 text-sm" data-testid={`row-lounge-report-${r.id}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">{r.reason}</p>
              <p className="mt-1 font-medium">{r.threadTitle} <span className="text-xs font-normal text-muted-foreground">({r.targetType === "thread" ? "thread" : "reply"})</span></p>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{r.excerpt}</p>
              <p className="mt-1 text-xs text-muted-foreground">Reported by {r.reporter} · {ago(r.createdAt)}</p>
              <div className="mt-2 flex gap-1.5">
                <button className={btnSm} onClick={() => onOpen(r.threadId)}>Open thread</button>
                <button className={btnSm} onClick={async () => { await apiRequest("POST", `/api/lounge/reports/${r.id}/resolve`); refetch(); }} data-testid={`button-resolve-report-${r.id}`}><CheckCircle2 className="h-3 w-3" />Resolve</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** /lounge: its own page for the Crew Lounge experience (admins only until the launch switch is on; the server 404s for everyone else). */
export default function LoungePage() {
  const { on, ready } = usePreviewState();
  if (!ready) return null;
  if (!on) return <NotFound />;
  return <LoungePanel />;
}
