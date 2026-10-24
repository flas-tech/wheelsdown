import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Router, Switch, Route, Link, useLocation, useRoute } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { LayoutDashboard, UtensilsCrossed, TicketPercent, ClipboardList, Megaphone, QrCode, Users, Building2, LogOut, UserCog, ExternalLink } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FboAccount, FboRole } from "@shared/fbo";
import { api, fboQuery, fboToken, setFboToken, get } from "./api";
import { Logo, ThemeProvider, ThemeToggle, inputCls, btnPrimary, Spinner } from "./ui";
import { DashboardPage } from "./dashboard";
import { PlacesPage } from "./places";
import { OffersPage } from "./offers";
import { IntelPage } from "./intel";
import { AdsPage } from "./ads";
import { QrPage, PrintPage } from "./print";
import { TeamPage, ProfilePage, AccountPage } from "./team";

const useHashPath = (): [string, (to: string, opts?: { replace?: boolean }) => void] => { const [loc, nav] = useHashLocation(); return [loc.split("?")[0], nav as any]; };

export type Me = {
  user: { id: number; fboId: number; email: string; name: string; role: FboRole };
  account: FboAccount & { publicUrl: string; qrUrl: string };
  adsServing: boolean;
  limits: Record<string, number>;
};
const MeCtx = createContext<{ me: Me; signOut: () => void } | null>(null);
export const useMe = () => useContext(MeCtx)!;

export default function FboApp() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={fboQuery}>
        <TooltipProvider>
          <Router hook={useHashPath}>
            <Gate />
          </Router>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function Gate() {
  const [token, setToken] = useState(fboToken());
  useEffect(() => { const f = () => setToken(""); window.addEventListener("fbo-signed-out", f); return () => window.removeEventListener("fbo-signed-out", f); }, []);
  const [isInvite, params] = useRoute("/invite/:token");
  const { data: me, isLoading, error } = useQuery<Me>({ queryKey: ["/api/fbo/me", token], queryFn: get("/api/fbo/me"), enabled: !!token });
  const signedIn = (t: string) => { setFboToken(t); fboQuery.clear(); setToken(t); window.location.hash = "#/"; };
  const signOut = async () => { try { await api("POST", "/api/fbo/logout"); } catch { /* */ } setFboToken(""); fboQuery.clear(); setToken(""); window.location.hash = "#/"; };

  if (isInvite) return <AuthFrame><InviteForm token={params!.token} onDone={signedIn} /></AuthFrame>;
  if (!token) return <AuthFrame><LoginForm onDone={signedIn} /></AuthFrame>;
  if (isLoading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-6 w-6 text-muted-foreground" /></div>;
  if (error || !me) return <AuthFrame><LoginForm onDone={signedIn} notice={(error as any)?.status === 403 ? (error as Error).message : undefined} /></AuthFrame>;
  return (
    <MeCtx.Provider value={{ me, signOut }}>
      <Switch>
        <Route path="/print/:kind">{(p) => <PrintPage kind={p.kind} />}</Route>
        <Route><Shell /></Route>
      </Switch>
    </MeCtx.Provider>
  );
}

// ------------------------------------------------------------- signed-out screens
function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="hidden lg:block">
          <div className="flex items-center gap-2 text-lg font-semibold"><Logo className="h-9 w-9" />Wheelsdown <span className="rounded-md bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">FBO</span></div>
          <h1 className="mt-8 text-3xl font-semibold leading-tight tracking-tight">Your desk's crew recommendations, one scan away.</h1>
          <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
            <li>Post the restaurants and hotels you already send crews to, or upload your existing list.</li>
            <li>Add crew discounts and FBO intel, labeled as coming from you.</li>
            <li>Print a QR card or counter sign that opens your page on any phone.</li>
          </ul>
          <p className="mt-8 text-xs text-muted-foreground">Invitation-only beta.</p>
        </div>
        <div className="w-full max-w-sm justify-self-center rounded-2xl border border-card-border bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2 font-semibold"><Logo className="h-7 w-7" />Wheelsdown <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">FBO</span></div>
            <ThemeToggle />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function LoginForm({ onDone, notice }: { onDone: (t: string) => void; notice?: string }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState(notice || ""); const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false); const [sent, setSent] = useState(false);
  if (forgot) return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api("POST", "/api/fbo/forgot", { email }); setSent(true); } catch (x: any) { setErr(x.message); } setBusy(false); }}>
      <h2 className="text-lg font-semibold">Reset your password</h2>
      {sent ? <p className="text-sm text-muted-foreground" data-testid="text-reset-sent">If that email has FBO access, a reset link is on its way. It works for one hour.</p> : <>
        <input className={inputCls} type="email" autoComplete="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-forgot-email" autoFocus />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button className={cn(btnPrimary, "h-10 w-full")} disabled={!email || busy}>{busy ? <Spinner /> : "Email me a link"}</button>
      </>}
      <button type="button" className="text-sm text-muted-foreground underline" onClick={() => { setForgot(false); setSent(false); setErr(""); }}>Back to sign in</button>
    </form>
  );
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr("");
      try { const r = await api<{ token: string }>("POST", "/api/fbo/login", { email, password: pw }); onDone(r.token); }
      catch (x: any) { setErr(x.message); }
      setBusy(false);
    }}>
      <div>
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p className="text-sm text-muted-foreground">For FBO staff with an invitation.</p>
      </div>
      <input className={inputCls} type="email" autoComplete="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" autoFocus />
      <input className={inputCls} type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="input-password" />
      {err && <p className="text-sm text-destructive" data-testid="text-login-error">{err}</p>}
      <button className={cn(btnPrimary, "h-10 w-full")} disabled={!email || !pw || busy} data-testid="button-login">{busy ? <Spinner /> : "Sign in"}</button>
      <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setForgot(true)} data-testid="button-forgot">Forgot password?</button>
    </form>
  );
}

function InviteForm({ token, onDone }: { token: string; onDone: (t: string) => void }) {
  const { data, error, isLoading } = useQuery<{ kind: string; email: string; fboName: string; icao: string; role: string }>({ queryKey: ["invite", token], queryFn: get(`/api/fbo/invite/${token}`) });
  const [name, setName] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (isLoading) return <Spinner />;
  if (error || !data) return <div className="space-y-3"><h2 className="text-lg font-semibold">Link not valid</h2><p className="text-sm text-muted-foreground">{(error as Error)?.message}</p><a className="text-sm underline" href="#/">Go to sign in</a></div>;
  const reset = data.kind === "reset";
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setErr("");
      if (pw !== pw2) return setErr("The passwords don't match.");
      setBusy(true);
      try { const r = await api<{ token: string }>("POST", `/api/fbo/invite/${token}`, { name, password: pw }); onDone(r.token); }
      catch (x: any) { setErr(x.message); }
      setBusy(false);
    }}>
      <div>
        <h2 className="text-lg font-semibold">{reset ? "Choose a new password" : `Join ${data.fboName}`}</h2>
        <p className="text-sm text-muted-foreground">{reset ? data.email : <>{data.icao} · signing in as <b>{data.email}</b> ({data.role})</>}</p>
      </div>
      {!reset && <input className={inputCls} placeholder="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-invite-name" autoFocus />}
      <input className={inputCls} type="password" autoComplete="new-password" placeholder="Password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="input-invite-password" />
      <input className={inputCls} type="password" autoComplete="new-password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="input-invite-password2" />
      {err && <p className="text-sm text-destructive" data-testid="text-invite-error">{err}</p>}
      <button className={cn(btnPrimary, "h-10 w-full")} disabled={busy || !pw || (!reset && !name)} data-testid="button-invite-submit">{busy ? <Spinner /> : reset ? "Save password" : "Create my login"}</button>
    </form>
  );
}

// ------------------------------------------------------------- signed-in shell
const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/places", label: "Recommendations", icon: UtensilsCrossed },
  { to: "/offers", label: "Discounts", icon: TicketPercent },
  { to: "/intel", label: "FBO intel", icon: ClipboardList },
  { to: "/ads", label: "Ads", icon: Megaphone },
  { to: "/qr", label: "QR & print", icon: QrCode },
  { to: "/team", label: "Team", icon: Users },
  { to: "/profile", label: "FBO profile", icon: Building2 },
];

function Shell() {
  const { me, signOut } = useMe();
  const [loc] = useLocation();
  const active = (to: string) => (to === "/" ? loc === "/" : loc.startsWith(to));
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-sidebar px-3 py-4 lg:flex">
        <div className="flex items-center gap-2 px-2 font-semibold"><Logo className="h-7 w-7" />Wheelsdown <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">FBO</span></div>
        <div className="mt-4 rounded-lg border border-sidebar-border bg-card px-3 py-2">
          <p className="truncate text-sm font-semibold" data-testid="text-fbo-name">{me.account.name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.account.icao}{me.account.airportName ? ` · ${me.account.airportName}` : ""}</p>
        </div>
        <nav className="mt-4 flex-1 space-y-0.5">
          {NAV.map((n) => (
            <Link key={n.to} href={n.to} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover-elevate", active(n.to) ? "bg-sidebar-accent font-semibold" : "text-muted-foreground")} data-testid={`nav-${n.to.slice(1) || "home"}`}>
              <n.icon className="h-4 w-4" />{n.label}
            </Link>
          ))}
        </nav>
        <a href={me.account.publicUrl} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover-elevate" data-testid="link-public-page"><ExternalLink className="h-4 w-4" />View crew page</a>
        <div className="flex items-center justify-between border-t border-sidebar-border pt-3">
          <Link href="/account" className="min-w-0 rounded-lg px-2 py-1 hover-elevate" data-testid="link-account">
            <p className="truncate text-sm font-medium">{me.user.name || me.user.email}</p>
            <p className="text-[11px] capitalize text-muted-foreground">{me.user.role}</p>
          </Link>
          <div className="flex items-center"><ThemeToggle /><button onClick={signOut} aria-label="Sign out" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover-elevate" data-testid="button-signout"><LogOut className="h-4 w-4" /></button></div>
        </div>
      </aside>

      {/* phone / tablet header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur lg:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex h-12 items-center justify-between px-3">
          <div className="flex min-w-0 items-center gap-2"><Logo className="h-6 w-6 shrink-0" /><span className="truncate text-sm font-semibold">{me.account.name}</span><span className="text-xs text-muted-foreground">{me.account.icao}</span></div>
          <div className="flex items-center"><ThemeToggle /><Link href="/account" aria-label="My login" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover-elevate"><UserCog className="h-4 w-4" /></Link><button onClick={signOut} aria-label="Sign out" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover-elevate"><LogOut className="h-4 w-4" /></button></div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map((n) => (
            <Link key={n.to} href={n.to} className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs hover-elevate", active(n.to) ? "bg-primary font-semibold text-primary-foreground" : "border border-border text-muted-foreground")}>
              <n.icon className="h-3.5 w-3.5" />{n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/places" component={PlacesPage} />
            <Route path="/offers" component={OffersPage} />
            <Route path="/intel" component={IntelPage} />
            <Route path="/ads" component={AdsPage} />
            <Route path="/qr" component={QrPage} />
            <Route path="/team" component={TeamPage} />
            <Route path="/profile" component={ProfilePage} />
            <Route path="/account" component={AccountPage} />
            <Route><p className="text-sm text-muted-foreground">Page not found. <Link href="/" className="underline">Back to the dashboard</Link></p></Route>
          </Switch>
        </div>
      </main>
    </div>
  );
}
