import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Router, Switch, Route, Link, useLocation, useRoute } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { LogOut, UserCog, ExternalLink, ArrowLeft, ChevronRight, Printer, Menu, X } from "lucide-react";
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
import { NAV, NAV_GROUPS, navItemFor, useBack, backLabel, useTrackNav } from "./nav";

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
  useTrackNav();
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
function Brand() {
  return <div className="flex items-center gap-2 font-semibold"><Logo className="h-7 w-7" />Wheelsdown <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">FBO</span></div>;
}

function Shell() {
  const { me, signOut } = useMe();
  const [loc] = useLocation();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [loc]);
  const active = (to: string) => (to === "/" ? loc === "/" : loc.startsWith(to));
  const item = navItemFor(loc);
  const back = useBack();
  const isHome = loc === "/";
  const TABS = ["/", "/places", "/offers", "/qr"].map((t) => NAV.find((n) => n.to === t)!);
  const moreActive = !TABS.some((t) => active(t.to));
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[248px_1fr]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-sidebar px-3 py-4 lg:flex">
        <Link href="/" className="rounded-lg px-2 py-1 hover-elevate" data-testid="link-brand"><Brand /></Link>
        <Link href="/profile" className="mt-3 block rounded-lg border border-sidebar-border bg-card px-3 py-2 hover-elevate" data-testid="link-fbo-card">
          <p className="truncate text-sm font-semibold" data-testid="text-fbo-name">{me.account.name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.account.icao}{me.account.airportName ? ` · ${me.account.airportName}` : ""}</p>
          <p className={cn("mt-1 inline-flex items-center gap-1 text-[11px] font-medium", me.account.verified ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", me.account.verified ? "bg-emerald-500" : "bg-amber-500")} />{me.account.verified ? "Crew page live" : "Not published yet"}
          </p>
        </Link>
        <nav className="no-scrollbar mt-3 flex-1 space-y-3 overflow-y-auto" aria-label="FBO portal">
          {NAV_GROUPS.map((g) => (
            <div key={g.label || "home"}>
              {g.label && <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.label}</p>}
              <div className="space-y-0.5">
                {g.items.map((n) => (
                  <Link key={n.to} href={n.to} aria-current={active(n.to) ? "page" : undefined} title={n.hint}
                    className={cn("relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover-elevate", active(n.to) ? "bg-sidebar-accent font-semibold text-foreground" : "text-muted-foreground")} data-testid={`nav-${n.to.slice(1) || "home"}`}>
                    {active(n.to) && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-primary" />}
                    <n.icon className="h-4 w-4 shrink-0" />{n.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <a href={me.account.publicUrl} target="_blank" rel="noreferrer" className="mb-2 mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover-elevate" data-testid="link-public-page"><ExternalLink className="h-4 w-4" />View crew page</a>
        <div className="flex items-center justify-between border-t border-sidebar-border pt-3">
          <Link href="/account" className={cn("min-w-0 rounded-lg px-2 py-1 hover-elevate", active("/account") && "bg-sidebar-accent")} data-testid="link-account">
            <p className="truncate text-sm font-medium">{me.user.name || me.user.email}</p>
            <p className="text-[11px] text-muted-foreground"><span className="capitalize">{me.user.role}</span> · My login</p>
          </Link>
          <div className="flex items-center"><ThemeToggle /><button onClick={signOut} aria-label="Sign out" title="Sign out" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover-elevate" data-testid="button-signout"><LogOut className="h-4 w-4" /></button></div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* top bar: back button + breadcrumb on desktop, title bar on phones */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:px-6 lg:px-10">
            {isHome ? (
              <Link href="/" className="lg:hidden"><Brand /></Link>
            ) : (
              <button onClick={() => back()} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border bg-card pl-2 pr-3 text-sm font-medium hover-elevate" aria-label={`Back to ${backLabel(loc)}`} data-testid="button-back">
                <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">{backLabel(loc)}</span><span className="sm:hidden">Back</span>
              </button>
            )}
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground lg:flex">
              {!isHome && <><Link href="/" className="rounded px-1 hover-elevate">Dashboard</Link><ChevronRight className="h-3.5 w-3.5" /></>}
              <span className="truncate font-medium text-foreground" data-testid="text-crumb">{item?.label ?? "Dashboard"}</span>
            </nav>
            {!isHome && <span className="min-w-0 truncate text-sm font-semibold lg:hidden" data-testid="text-mobile-title">{item?.label}</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <a href={me.account.publicUrl} target="_blank" rel="noreferrer" className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover-elevate sm:inline-flex lg:hidden" data-testid="link-public-top"><ExternalLink className="h-4 w-4" />Crew page</a>
              {!active("/qr") && <Link href="/qr" className="hidden h-9 items-center gap-1.5 rounded-lg taxi-sign px-3 text-sm font-semibold hover-elevate sm:inline-flex" data-testid="link-print-top"><Printer className="h-4 w-4" />Print QR</Link>}
              <span className="lg:hidden"><ThemeToggle /></span>
            </div>
          </div>
        </header>

        <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-10 lg:pt-7">
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

      {/* phone / tablet bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="FBO portal">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {TABS.map((n) => (
            <Link key={n.to} href={n.to} aria-current={active(n.to) ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active(n.to) ? "font-semibold text-foreground" : "text-muted-foreground")} data-testid={`tab-${n.to.slice(1) || "home"}`}>
              <span className={cn("grid h-7 w-12 place-items-center rounded-full", active(n.to) && "bg-primary text-primary-foreground")}><n.icon className="h-[18px] w-[18px]" /></span>{n.short}
            </Link>
          ))}
          <button onClick={() => setMore(true)} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", moreActive ? "font-semibold text-foreground" : "text-muted-foreground")} data-testid="tab-more">
            <span className={cn("grid h-7 w-12 place-items-center rounded-full", moreActive && "bg-primary text-primary-foreground")}><Menu className="h-[18px] w-[18px]" /></span>More
          </button>
        </div>
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background px-4 pt-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="mb-3 flex items-center justify-between">
              <div className="min-w-0"><p className="truncate font-semibold">{me.account.name}</p><p className="text-xs text-muted-foreground">{me.account.icao} · {me.user.name || me.user.email}</p></div>
              <button onClick={() => setMore(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover-elevate"><X className="h-4 w-4" /></button>
            </div>
            {NAV_GROUPS.filter((g) => g.label).map((g) => (
              <div key={g.label} className="mb-3">
                <p className="pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.label}</p>
                <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                  {g.items.map((n) => (
                    <Link key={n.to} href={n.to} className={cn("flex items-center gap-3 border-b border-border px-3 py-3 last:border-0 hover-elevate", active(n.to) && "bg-sidebar-accent")} data-testid={`more-${n.to.slice(1)}`}>
                      <n.icon className="h-[18px] w-[18px] text-muted-foreground" />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{n.label}</span><span className="block truncate text-xs text-muted-foreground">{n.hint}</span></span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <div className="overflow-hidden rounded-xl border border-card-border bg-card">
              <a href={me.account.publicUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 border-b border-border px-3 py-3 text-sm font-medium hover-elevate"><ExternalLink className="h-[18px] w-[18px] text-muted-foreground" />View crew page</a>
              <Link href="/account" className="flex items-center gap-3 border-b border-border px-3 py-3 text-sm font-medium hover-elevate" data-testid="more-account"><UserCog className="h-[18px] w-[18px] text-muted-foreground" />My login</Link>
              <button onClick={signOut} className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm font-medium text-destructive hover-elevate" data-testid="more-signout"><LogOut className="h-[18px] w-[18px]" />Sign out</button>
            </div>
          </div>
        </div>
      )}
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
