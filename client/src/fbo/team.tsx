import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus, Trash2, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FBO_LIMITS, FBO_ROLE_LABEL, type FboRole } from "@shared/fbo";
import { api, get, fboQuery } from "./api";
import { useMe } from "./App";
import { Card, Field, PageHeader, Spinner, areaCls, btn, btnGhost, btnPrimary, inputCls, fmtWhen, Counter } from "./ui";

type Member = { id: number; email: string; name: string; role: FboRole; status: string; createdAt: number; lastLoginAt: number | null };

export function TeamPage() {
  const { me } = useMe();
  const owner = me.user.role === "owner";
  const { data: team, isLoading } = useQuery<Member[]>({ queryKey: ["/api/fbo/team"], queryFn: get("/api/fbo/team") });
  const [email, setEmail] = useState(""); const [role, setRole] = useState<FboRole>("editor");
  const [link, setLink] = useState<{ link: string; emailed: boolean } | null>(null);
  const { toast } = useToast();
  const refresh = () => fboQuery.invalidateQueries({ queryKey: ["/api/fbo/team"] });
  const invite = useMutation({
    mutationFn: () => api<{ link: string; emailed: boolean }>("POST", "/api/fbo/team", { email, role }),
    onSuccess: (r) => { setLink(r); setEmail(""); refresh(); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const setRoleM = useMutation({ mutationFn: ({ id, role }: { id: number; role: FboRole }) => api("PATCH", `/api/fbo/team/${id}`, { role }), onSuccess: refresh, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) });
  const remove = useMutation({ mutationFn: (id: number) => api("DELETE", `/api/fbo/team/${id}`), onSuccess: () => { refresh(); toast({ title: "Access removed" }); }, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) });
  return (
    <>
      <PageHeader title="Team" sub={`Everyone at ${me.account.name} who can sign in. Each person has their own login, and changes are recorded with their name. Owners manage the team; editors manage everything else.`} />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden p-0">
          {isLoading ? <div className="p-4"><Spinner /></div> : (
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Person</th><th className="px-3 py-2 font-medium">Role</th><th className="hidden px-3 py-2 font-medium sm:table-cell">Last sign-in</th><th className="w-10"></th></tr></thead>
              <tbody>
                {(team || []).map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0" data-testid={`row-member-${u.id}`}>
                    <td className="px-3 py-2.5"><p className="font-medium">{u.name || u.email}{u.id === me.user.id && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}</p><p className="text-xs text-muted-foreground">{u.email}{u.status === "invited" && " · invitation sent"}</p></td>
                    <td className="px-3 py-2.5">
                      {owner ? (
                        <select className={inputCls + " h-8 w-28"} value={u.role} onChange={(e) => setRoleM.mutate({ id: u.id, role: e.target.value as FboRole })} data-testid={`select-role-${u.id}`}>
                          <option value="owner">Owner</option><option value="editor">Editor</option>
                        </select>
                      ) : FBO_ROLE_LABEL[u.role]}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-muted-foreground sm:table-cell">{u.lastLoginAt ? fmtWhen(u.lastLoginAt) : "Never"}</td>
                    <td className="px-2">{owner && u.id !== me.user.id && <button className={btnGhost} aria-label="Remove access" onClick={() => { if (confirm(`Remove ${u.email}? They'll be signed out right away.`)) remove.mutate(u.id); }} data-testid={`button-remove-${u.id}`}><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <p className="text-sm font-semibold">Invite someone</p>
          {owner ? (
            <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); setLink(null); invite.mutate(); }}>
              <Field label="Email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourfbo.com" data-testid="input-invite-email" /></Field>
              <Field label="Role"><select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as FboRole)} data-testid="select-invite-role"><option value="editor">Editor: recommendations, discounts, intel, ads, printing</option><option value="owner">Owner: all of that plus the team</option></select></Field>
              <button className={btnPrimary + " w-full"} disabled={!email || invite.isPending} data-testid="button-send-invite">{invite.isPending ? <Spinner /> : <UserPlus className="h-4 w-4" />}Send invitation</button>
              {link && (
                <div className="rounded-lg bg-muted/60 p-3 text-xs" data-testid="text-invite-link">
                  <p className="font-medium">{link.emailed ? "Invitation emailed." : "Email didn't send. Share this link with them directly:"}</p>
                  <div className="mt-2 flex gap-2"><input readOnly className={inputCls + " h-8 font-code text-[11px]"} value={link.link} onFocus={(e) => e.currentTarget.select()} /><button type="button" className={btn + " h-8"} onClick={() => navigator.clipboard.writeText(link.link).catch(() => {})}><Copy className="h-3.5 w-3.5" /></button></div>
                  <p className="mt-1 text-muted-foreground">The link works for 14 days and only once.</p>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Up to {FBO_LIMITS.users} people per account during the beta.</p>
            </form>
          ) : <p className="mt-2 text-sm text-muted-foreground">Ask an owner on your account to invite teammates.</p>}
        </Card>
      </div>
    </>
  );
}

export function ProfilePage() {
  const { me } = useMe();
  const a = me.account;
  const [f, setF] = useState({ name: a.name, phone: a.phone, email: a.email, website: a.website, address: a.address, about: a.about });
  useEffect(() => setF({ name: a.name, phone: a.phone, email: a.email, website: a.website, address: a.address, about: a.about }), [a]);
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => api("PATCH", "/api/fbo/account", f),
    onSuccess: () => { fboQuery.invalidateQueries({ queryKey: ["/api/fbo/me"] }); toast({ title: "Saved", description: "Live on your crew page." }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <PageHeader title="FBO profile" sub="The header of your crew page. Your airport and page address are set by Wheelsdown so printed QR codes keep working." />
      <Card className="max-w-3xl">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="FBO name" className="sm:col-span-2"><input className={inputCls} value={f.name} onChange={set("name")} maxLength={FBO_LIMITS.name} data-testid="input-profile-name" /></Field>
          <Field label="Airport"><input className={inputCls} value={`${a.icao}${a.airportName ? " · " + a.airportName : ""}`} disabled /></Field>
          <Field label="Crew page address"><input className={inputCls} value={a.publicUrl.replace(/^https?:\/\//, "")} disabled /></Field>
          <Field label="Desk phone"><input className={inputCls} value={f.phone} onChange={set("phone")} maxLength={40} inputMode="tel" data-testid="input-profile-phone" /></Field>
          <Field label="Desk email (not shown to crews)"><input className={inputCls} value={f.email} onChange={set("email")} maxLength={200} type="email" data-testid="input-profile-email" /></Field>
          <Field label="Website"><input className={inputCls} value={f.website} onChange={set("website")} maxLength={400} data-testid="input-profile-website" /></Field>
          <Field label="Address"><input className={inputCls} value={f.address} onChange={set("address")} maxLength={FBO_LIMITS.short} data-testid="input-profile-address" /></Field>
          <Field label="A line for crews" className="sm:col-span-2" hint={<Counter value={f.about} max={FBO_LIMITS.about} />}><textarea className={areaCls} rows={3} value={f.about} onChange={set("about")} maxLength={FBO_LIMITS.about} placeholder="Welcome to KBED. Ask the desk for a crew car, we're open 24 hours." data-testid="input-profile-about" /></Field>
          <div className="flex justify-end sm:col-span-2"><button className={btnPrimary} disabled={save.isPending} data-testid="button-save-profile">{save.isPending ? <Spinner /> : "Save"}</button></div>
        </form>
      </Card>
    </>
  );
}

export function AccountPage() {
  const { me } = useMe();
  const [name, setName] = useState(me.user.name);
  const [pw, setPw] = useState(""); const [npw, setNpw] = useState("");
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: (b: any) => api("PATCH", "/api/fbo/me", b),
    onSuccess: () => { fboQuery.invalidateQueries({ queryKey: ["/api/fbo/me"] }); setPw(""); setNpw(""); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  return (
    <>
      <PageHeader title="My login" sub={me.user.email} />
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Card>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate({ name }); }}>
            <Field label="Your name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="input-my-name" /></Field>
            <button className={btnPrimary} disabled={!name || save.isPending}>Save name</button>
          </form>
        </Card>
        <Card>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate({ password: pw, newPassword: npw }); }}>
            <Field label="Current password"><input className={inputCls} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="New password (10+ characters)"><input className={inputCls} type="password" autoComplete="new-password" value={npw} onChange={(e) => setNpw(e.target.value)} /></Field>
            <button className={btnPrimary} disabled={!pw || npw.length < 10 || save.isPending}>Change password</button>
          </form>
        </Card>
      </div>
    </>
  );
}
