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
import { Welcome } from "./welcome";

const useHashPath = (): [string, (to: string, opts?: { replace?: boolean }) => void] => { const [loc, nav] = useHashLocation(); return [loc.split("?")[0], nav as any]; };

export type Me = {
  user: { id: number; fboId: number; email: string; name: string; role: FboRole; onboarded: boolean };
  account: FboAccount & { publicUrl: string; qrUrl: string; kioskUrl: string; verified: boolean; signupSource: string };
  adsServing: boolean;
  limits: Record<string, number>;
};
const MeCtx = createContext<{ me: Me; signOut: () => void; openWelcome: () => void } | null>(null);
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
  const [isVerify, vparams] = useRoute("/verify/:token");
  const [isSignup] = useRoute("/signup");
  const [welcome, setWelcome] = useState(false);
  const { data: me, isLoading, error } = useQuery<Me>({ queryKey: ["/api/fbo/me", token], queryFn: get("/api/fbo/me"), enabled: !!token });
  const signedIn = (t: string) => { setFboToken(t); fboQuery.clear(); setToken(t); window.location.hash = "#/"; };
  const signOut = async () => { try { await api("POST", "/api/fbo/logout"); } catch { /* */ } setFboToken(""); fboQuery.clear(); setToken(""); window.location.hash = "#/"; };

  if (isInvite) return <AuthFrame><InviteForm token={params!.token} onDone={signedIn} /></AuthFrame>;
  if (isVerify) return <AuthFrame><VerifyEmail token={vparams!.token} signedIn={!!token} /></AuthFrame>;
  if (isSignup && !token) return <AuthFrame><SignupForm onDone={signedIn} /></AuthFrame>;
  if (!token) return <AuthFrame><LoginForm onDone={signedIn} /></AuthFrame>;
  if (isLoading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-6 w-6 text-muted-foreground" /></div>;
  if (error || !me) return <AuthFrame><LoginForm onDone={signedIn} notice={(error as any)?.status === 403 ? (error as Error).message : undefined} /></AuthFrame>;
  return (
    <MeCtx.Provider value={{ me, signOut, openWelcome: () => setWelcome(true) }}>
      {(welcome || !me.user.onboarded) && !window.location.hash.startsWith("#/print") && <Welcome onClose={() => { setWelcome(false); fboQuery.setQueryData(["/api/fbo/me", token], { ...me, user: { ...me.user, onboarded: true } }); }} />}
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
          <p className="mt-8 text-xs text-muted-foreground">Free for FBOs. Nothing to install: it works in any browser and can be added to your home screen.</p>
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
        <p className="text-sm text-muted-foreground">For FBO desk and management staff.</p>
      </div>
      <input className={inputCls} type="email" autoComplete="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" autoFocus />
      <input className={inputCls} type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="input-password" />
      {err && <p className="text-sm text-destructive" data-testid="text-login-error">{err}</p>}
      <button className={cn(btnPrimary, "h-10 w-full")} disabled={!email || !pw || busy} data-testid="button-login">{busy ? <Spinner /> : "Sign in"}</button>
      <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setForgot(true)} data-testid="button-forgot">Forgot password?</button>
      <div className="border-t border-border pt-4 text-sm">New to Wheelsdown? <a href="#/signup" className="font-semibold underline" data-testid="link-signup">Create an FBO account</a></div>
    </form>
  );
}

function SignupForm({ onDone }: { onDone: (t: string) => void }) {
  const { data: cfg } = useQuery<{ open: boolean; passwordMin: number }>({ queryKey: ["/api/fbo/signup"], queryFn: get("/api/fbo/signup") });
  const ref = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1)).get("ref") || "";
  const [f, setF] = useState({ fboName: "", icao: "", name: "", email: "", password: "", agree: false });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "icao" ? e.target.value.toUpperCase().slice(0, 4) : e.target.value });
  if (cfg && !cfg.open) return <div className="space-y-3"><h2 className="text-lg font-semibold">Sign-up is paused</h2><p className="text-sm text-muted-foreground">Email <a className="underline" href="mailto:hello@getwheelsdown.com">hello@getwheelsdown.com</a> and we'll set up your FBO.</p><a className="text-sm underline" href="#/">Sign in</a></div>;
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setErr(""); setBusy(true);
      try { const r = await api<{ token: string }>("POST", "/api/fbo/signup", { ...f, ref }); onDone(r.token); }
      catch (x: any) { setErr(x.message); }
      setBusy(false);
    }}>
      <div>
        <h2 className="text-lg font-semibold">Create your FBO account</h2>
        <p className="text-sm text-muted-foreground">Free. One account per FBO location; invite the rest of your team after.</p>
      </div>
      <input className={inputCls} placeholder="FBO name, e.g. Signature TEB" value={f.fboName} onChange={set("fboName")} maxLength={120} autoFocus data-testid="input-signup-fbo" />
      <input className={inputCls} placeholder="Airport code, e.g. KTEB" value={f.icao} onChange={set("icao")} autoCapitalize="characters" data-testid="input-signup-icao" />
      <input className={inputCls} placeholder="Your name" autoComplete="name" value={f.name} onChange={set("name")} maxLength={80} data-testid="input-signup-name" />
      <input className={inputCls} type="email" autoComplete="email" placeholder="Work email" value={f.email} onChange={set("email")} data-testid="input-signup-email" />
      <input className={inputCls} type="password" autoComplete="new-password" placeholder={`Password (${cfg?.passwordMin || 10}+ characters)`} value={f.password} onChange={set("password")} data-testid="input-signup-password" />
      <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-signup-agree" />
        <span>I work for this FBO and agree to the <a className="underline" href="https://getwheelsdown.com/#/terms" target="_blank" rel="noreferrer">Terms</a> and <a className="underline" href="https://getwheelsdown.com/#/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
      {err && <p className="text-sm text-destructive" data-testid="text-signup-error">{err}</p>}
      <button className={cn(btnPrimary, "h-10 w-full")} disabled={busy || !f.fboName || !f.icao || !f.name || !f.email || !f.password || !f.agree} data-testid="button-signup">{busy ? <Spinner /> : "Create account"}</button>
      <p className="text-sm">Already have an account? <a href="#/" className="font-semibold underline">Sign in</a></p>
    </form>
  );
}

function VerifyEmail({ token, signedIn }: { token: string; signedIn: boolean }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["verify", token], queryFn: () => api("POST", `/api/fbo/verify/${token}`), retry: false, staleTime: Infinity });
  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{data ? "Email confirmed" : "Link not valid"}</h2>
      <p className="text-sm text-muted-foreground" data-testid="text-verify">{data ? "Your crew page is published, and any places you added are now live for crews." : (error as Error)?.message}</p>
      <a className={cn(btnPrimary, "h-10 w-full")} href="#/" onClick={() => fboQuery.invalidateQueries()}>{signedIn ? "Go to the dashboard" : "Sign in"}</a>
    </div>
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
          {!me.account.verified && <VerifyBanner />}
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

function VerifyBanner() {
  const [state, setState] = useState<"" | "busy" | string>("");
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm" data-testid="banner-verify">
      <p><b>Confirm your email to publish your crew page.</b> We sent a link when you signed up. Until then crews who scan your QR code see "not published yet."</p>
      <button className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover-elevate" disabled={state === "busy"} onClick={async () => { setState("busy"); try { const r = await api<{ email?: string }>("POST", "/api/fbo/verify-resend"); setState(`Sent to ${r.email || "your email"}`); } catch (e: any) { setState(e.message); } }} data-testid="button-resend-verify">
        {state && state !== "busy" ? state : "Resend the link"}
      </button>
    </div>
  );
}
