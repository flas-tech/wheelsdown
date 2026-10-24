/** Admin: FBO portal beta. Create invite-only FBO accounts, watch how each one is used, and pause anything abusive. */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, ExternalLink, AlertTriangle, Pause, Play, Trash2, Copy, ChevronRight, ArrowLeft, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { AdmApi } from "./adminOps";

const inputCls = "w-full h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const btn = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-medium border border-border bg-card hover-elevate disabled:opacity-50";
const btnPrimary = "inline-flex items-center gap-1.5 h-9 rounded-lg px-3 text-sm font-semibold taxi-sign hover-elevate disabled:opacity-50";
const when = (t: number | null) => (t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");
const ago = (t: number | null) => { if (!t) return "never"; const d = (Date.now() - t) / 86400000; return d < 1 ? "today" : d < 2 ? "yesterday" : `${Math.floor(d)} days ago`; };

type Row = {
  id: number; slug: string; name: string; icao: string; airportName: string; status: string; createdAt: number; createdBy: string; publicUrl: string;
  lastActiveAt: number | null; lastLoginAt: number | null; usersActive: number; usersInvited: number; places: number; favorites: number; offersActive: number; intel: number;
  ads: number; adsActive: number; adImpressions: number; adClicks: number; views7: number; views30: number; qr30: number; devices30: number; edits24: number; prints: number; imports: number;
  flags: string[]; idle: boolean;
};
type List = { adsServing: boolean; fboUrl: string; accounts: Row[] };

export function FboAdminPanel({ api }: { api: AdmApi }) {
  const { adm, admGet } = api;
  const { data, isLoading } = useQuery<List>({ queryKey: ["/api/admin/fbo"], queryFn: admGet("/api/admin/fbo"), refetchInterval: 60_000 });
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/fbo"] });
  const serving = useMutation({ mutationFn: async (v: boolean) => (await adm("PUT", "/api/admin/fbo-settings", { adsServing: v })).json(), onSuccess: refresh });
  if (open != null) return <FboDetail api={api} id={open} onBack={() => { setOpen(null); refresh(); }} />;
  const rows = data?.accounts || [];
  const tot = rows.reduce((m, r) => ({ views: m.views + r.views30, qr: m.qr + r.qr30, imp: m.imp + r.adImpressions, places: m.places + r.places }), { views: 0, qr: 0, imp: 0, places: 0 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">FBO portal <span className="ml-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase">Beta</span></h2>
          <p className="max-w-2xl text-xs text-muted-foreground">Invite-only. FBO logins are separate from crew accounts: they never earn points or appear on the leaderboard, and nothing in the crew app links to the portal. Sign-in: <a className="underline" href={data?.fboUrl} target="_blank" rel="noreferrer">{data?.fboUrl}</a></p>
        </div>
        <button className={btnPrimary} onClick={() => setCreating(true)} data-testid="button-fbo-create"><Plus className="h-4 w-4" />New FBO account</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-card-border bg-card p-3">
        <Switch checked={!!data?.adsServing} onCheckedChange={(v) => serving.mutate(v)} data-testid="switch-fbo-ads-serving" />
        <div className="text-sm"><p className="font-medium">Serve FBO ads in the crew app</p><p className="text-xs text-muted-foreground">{data?.adsServing ? "On: active FBO ads run at their own airport, labeled Sponsored." : "Off: FBOs can build ads, but crews don't see any yet."}</p></div>
        <div className="ml-auto grid grid-cols-4 gap-4 text-center text-xs">
          {[["Accounts", rows.length], ["Picks", tot.places], ["Page views 30d", tot.views], ["QR scans 30d", tot.qr]].map(([l, v]) => <div key={l as string}><p className="text-lg font-semibold tabular">{v}</p><p className="text-muted-foreground">{l}</p></div>)}
        </div>
      </div>

      {creating && <CreateForm api={api} onDone={() => { setCreating(false); refresh(); }} />}

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !rows.length ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No FBO accounts yet. Create one to invite an FBO into the beta.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>{["FBO", "Status", "People", "Last active", "Picks · fav · deals", "Ads (running) · imp · clicks", "Views 7d / 30d · QR", "Edits 24h", "Flags", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-border last:border-0 align-top hover:bg-muted/40" onClick={() => setOpen(r.id)} data-testid={`row-fbo-${r.id}`}>
                  <td className="px-3 py-2.5"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.icao} · /f/{r.slug}</p></td>
                  <td className="px-3 py-2.5"><span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", r.status === "active" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-destructive/15 text-destructive")}>{r.status === "active" ? "Active" : "Paused"}</span>{r.idle && <p className="mt-1 text-[11px] text-muted-foreground">Never signed in</p>}</td>
                  <td className="px-3 py-2.5 tabular">{r.usersActive}{r.usersInvited ? <span className="text-xs text-muted-foreground"> +{r.usersInvited} invited</span> : null}</td>
                  <td className="px-3 py-2.5 text-xs">{ago(r.lastActiveAt || r.lastLoginAt)}</td>
                  <td className="px-3 py-2.5 tabular">{r.places} · {r.favorites} · {r.offersActive}<p className="text-[11px] text-muted-foreground">{r.intel} intel fields · {r.imports} imports</p></td>
                  <td className="px-3 py-2.5 tabular">{r.ads} ({r.adsActive}) · {r.adImpressions} · {r.adClicks}</td>
                  <td className="px-3 py-2.5 tabular">{r.views7} / {r.views30} · {r.qr30}<p className="text-[11px] text-muted-foreground">{r.prints} prints/downloads</p></td>
                  <td className={cn("px-3 py-2.5 tabular", r.edits24 > 100 && "font-semibold text-destructive")}>{r.edits24}</td>
                  <td className="max-w-[220px] px-3 py-2.5">{r.flags.length ? r.flags.map((f) => <p key={f} className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{f}</p>) : <span className="text-xs text-muted-foreground">—</span>}</td>
                  <td className="px-2 py-2.5"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Views count each device once per day per source (QR scan or shared link); bots, link previews and admin requests are excluded. Flags are prompts to look, not proof of misuse.</p>
    </div>
  );
}

function CreateForm({ api, onDone }: { api: AdmApi; onDone: () => void }) {
  const [f, setF] = useState({ name: "", icao: "", ownerEmail: "" });
  const [res, setRes] = useState<any>(null);
  const { toast } = useToast();
  const create = useMutation({
    mutationFn: async () => (await api.adm("POST", "/api/admin/fbo", f)).json(),
    onSuccess: (r) => setRes(r),
    onError: (e: Error) => toast({ title: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });
  if (res) return (
    <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm" data-testid="text-fbo-created">
      <p className="font-semibold">{res.account.name} ({res.account.icao}) created.</p>
      <p className="mt-1">{res.invite.emailed ? `Invitation emailed to ${f.ownerEmail}.` : "Email didn't send. Share this sign-up link with the owner:"}</p>
      <div className="mt-2 flex gap-2"><input readOnly className={inputCls + " font-code text-xs"} value={res.invite.link} onFocus={(e) => e.currentTarget.select()} data-testid="input-fbo-invite-link" /><button className={btn} onClick={() => navigator.clipboard.writeText(res.invite.link).catch(() => {})}><Copy className="h-4 w-4" /></button></div>
      <p className="mt-2 text-xs text-muted-foreground">Crew page: {res.account.publicUrl}. The link works once, for 14 days.</p>
      <button className={btn + " mt-3"} onClick={onDone}>Done</button>
    </div>
  );
  return (
    <form className="grid gap-3 rounded-xl border border-card-border bg-card p-4 sm:grid-cols-[2fr_1fr_2fr_auto]" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <input className={inputCls} placeholder="FBO name (e.g. Signature BED)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-fbo-name" autoFocus />
      <input className={inputCls + " uppercase"} placeholder="Airport (KBED)" value={f.icao} maxLength={4} onChange={(e) => setF({ ...f, icao: e.target.value })} data-testid="input-fbo-icao" />
      <input className={inputCls} type="email" placeholder="Owner email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} data-testid="input-fbo-owner" />
      <div className="flex gap-2"><button type="button" className={btn} onClick={onDone}>Cancel</button><button className={btnPrimary} disabled={!f.name || !f.icao || !f.ownerEmail || create.isPending} data-testid="button-fbo-create-submit">Create & invite</button></div>
    </form>
  );
}

function FboDetail({ api, id, onBack }: { api: AdmApi; id: number; onBack: () => void }) {
  const { data, refetch } = useQuery<any>({ queryKey: ["/api/admin/fbo", id], queryFn: api.admGet(`/api/admin/fbo/${id}`) });
  const [invite, setInvite] = useState(""); const [link, setLink] = useState("");
  const [kind, setKind] = useState("all");
  const { toast } = useToast();
  const act = useMutation({
    mutationFn: async ({ method, url, body }: { method: string; url: string; body?: any }) => (await api.adm(method, url, body)).json(),
    onSuccess: () => refetch(), onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const a = data.account;
  const events = (data.events as any[]).filter((e) => kind === "all" || e.kind === kind);
  const kinds = Array.from(new Set((data.events as any[]).map((e) => e.kind)));
  const totals = (data.daily as any[]).reduce((m, d) => ({ v: m.v + d.views, q: m.q + d.qr, d: m.d + d.devices }), { v: 0, q: 0, d: 0 });
  return (
    <div className="space-y-4">
      <button className={btn} onClick={onBack}><ArrowLeft className="h-4 w-4" />All FBO accounts</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{a.name}</h2><p className="text-xs text-muted-foreground">{a.icao}{a.airportName ? ` · ${a.airportName}` : ""} · created {when(a.createdAt)} · <a className="underline" href={a.publicUrl} target="_blank" rel="noreferrer">crew page <ExternalLink className="inline h-3 w-3" /></a></p></div>
        <div className="flex gap-2">
          {a.status === "active"
            ? <button className={btn} onClick={() => { if (confirm(`Pause ${a.name}? Their crew page goes offline, their ads stop and everyone is signed out.`)) act.mutate({ method: "PATCH", url: `/api/admin/fbo/${id}`, body: { status: "suspended" } }); }} data-testid="button-fbo-pause"><Pause className="h-4 w-4" />Pause account</button>
            : <button className={btnPrimary} onClick={() => act.mutate({ method: "PATCH", url: `/api/admin/fbo/${id}`, body: { status: "active" } })} data-testid="button-fbo-resume"><Play className="h-4 w-4" />Resume account</button>}
          <button className={btn + " text-destructive"} onClick={async () => { if (confirm(`Delete ${a.name} and everything it posted? Printed QR codes will stop working.`)) { await api.adm("DELETE", `/api/admin/fbo/${id}`); onBack(); } }} data-testid="button-fbo-delete"><Trash2 className="h-4 w-4" />Delete</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[["Page views 30d", totals.v], ["QR scans 30d", totals.q], ["Device-days 30d", totals.d], ["Picks", data.places.length]].map(([l, v]) => <div key={l} className="rounded-xl border border-card-border bg-card p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-semibold tabular">{v}</p></div>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-card-border bg-card p-3">
          <p className="mb-2 text-sm font-semibold">People</p>
          <table className="w-full text-xs"><tbody>{data.users.map((u: any) => <tr key={u.id} className="border-t border-border first:border-0"><td className="py-1.5"><b>{u.name || "—"}</b> {u.email}</td><td className="capitalize">{u.role}</td><td className="capitalize">{u.status}</td><td className="text-muted-foreground">{when(u.lastLoginAt)}</td></tr>)}</tbody></table>
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { const r = await (await api.adm("POST", `/api/admin/fbo/${id}/invite`, { email: invite, role: "owner" })).json(); setLink(r.link); setInvite(""); refetch(); } catch (x: any) { toast({ title: x.message, variant: "destructive" }); } }}>
            <input className={inputCls} type="email" placeholder="Invite another owner (or resend)" value={invite} onChange={(e) => setInvite(e.target.value)} />
            <button className={btn} disabled={!invite}>Invite</button>
          </form>
          {link && <input readOnly className={inputCls + " mt-2 font-code text-[11px]"} value={link} onFocus={(e) => e.currentTarget.select()} />}
        </section>
        <section className="rounded-xl border border-card-border bg-card p-3">
          <p className="mb-2 text-sm font-semibold">Ads</p>
          {!data.ads.length ? <p className="text-xs text-muted-foreground">None.</p> : data.ads.map((ad: any) => (
            <div key={ad.id} className="flex items-center gap-2 border-t border-border py-1.5 text-xs first:border-0">
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{ad.headline}</p><p className="truncate text-muted-foreground">{ad.url} · {ad.slot} · {ad.impressions} imp · {ad.clicks} clicks</p></div>
              <Switch checked={ad.active} onCheckedChange={(v) => act.mutate({ method: "POST", url: `/api/admin/fbo/${id}/ads/${ad.id}`, body: { active: v } })} />
            </div>
          ))}
          <p className="mb-2 mt-4 text-sm font-semibold">Discounts</p>
          {!data.offers.length ? <p className="text-xs text-muted-foreground">None.</p> : data.offers.slice(0, 30).map((o: any) => <p key={o.id} className="truncate border-t border-border py-1 text-xs first:border-0">{o.active ? "" : "(off) "}<b>{o.title}</b> {o.code && <span className="font-code">{o.code}</span>} {o.expiresOn ? `· to ${o.expiresOn}` : "· no end"}</p>)}
        </section>
      </div>

      <section className="rounded-xl border border-card-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Activity</p>
          <select className={inputCls.replace("w-full", "w-auto") + " !h-8"} value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All activity</option>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs"><tbody>{events.map((e: any, i: number) => <tr key={i} className="border-t border-border first:border-0"><td className="whitespace-nowrap py-1 pr-3 text-muted-foreground">{when(e.at)}</td><td className="pr-3 font-medium">{e.kind}</td><td className="pr-3">{e.actor}</td><td className="text-muted-foreground">{e.detail}</td></tr>)}</tbody></table>
          {!events.length && <p className="text-xs text-muted-foreground">No activity yet.</p>}
        </div>
      </section>
      <section className="rounded-xl border border-card-border bg-card p-3">
        <p className="mb-2 text-sm font-semibold">Recommendations ({data.places.length})</p>
        <div className="max-h-72 overflow-y-auto text-xs">{data.places.map((p: any) => <p key={p.id} className="border-t border-border py-1 first:border-0">{p.favorite ? "★ " : ""}<b>{p.name}</b> <span className="text-muted-foreground">{p.category} · {p.address} {p.website}</span>{p.hidden ? " (hidden)" : ""}</p>)}</div>
      </section>
    </div>
  );
}
