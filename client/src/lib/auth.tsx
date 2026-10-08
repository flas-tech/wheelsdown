import { startTourForNewMember } from "@/lib/tour";
import { pendingRef, clearRef } from "@/lib/referral";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, setAuthToken, getAuthToken, IS_STATIC } from "@/lib/queryClient";
import { TIERS, tierFor, publicName, SEED_PASSWORD, SOLO_POINTS, type Me, type PublicUser, type TierId } from "@shared/tiers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { WRIGHT_NAME, WRIGHT_SEATS } from "@shared/club";

type AuthCtx = {
  me: Me | null;
  loading: boolean;
  /** Run fn if signed in, otherwise open the sign-in sheet (and run fn after success). */
  requireAuth: (fn?: () => void, reason?: string) => void;
  logout: () => void;
  openAuth: (reason?: string) => void;
};
const Ctx = createContext<AuthCtx>({ me: null, loading: false, requireAuth: () => {}, logout: () => {}, openAuth: () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const { data: me, isLoading } = useQuery<Me | null>({ queryKey: ["/api/me"] });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const pending = useRef<(() => void) | undefined>();

  // Points / promotion feedback
  const prev = useRef<{ id: number; points: number } | null>(null);
  useEffect(() => {
    if (!me) { prev.current = null; return; }
    const p = prev.current;
    if (p && p.id === me.id && me.points > p.points) {
      const before = tierFor(p.points).tier, after = tierFor(me.points).tier;
      if (after.id !== before.id) toast({ title: `Promoted to ${after.name}`, description: `${after.tagline}. ${me.points.toLocaleString()} points in your logbook.` });
      else toast({ title: `+${me.points - p.points} pts`, description: (() => { const t = tierFor(me.points); return `${me.points.toLocaleString()} total · ${t.next ? `${t.toNext.toLocaleString()} to ${t.next.name}` : "top of the ladder"}`; })() });
    }
    prev.current = { id: me.id, points: me.points };
  }, [me?.id, me?.points]);

  const openAuth = (r?: string) => { setReason(r); setOpen(true); };
  const requireAuth = (fn?: () => void, r?: string) => {
    if (me) return fn?.();
    pending.current = fn;
    openAuth(r);
  };
  const onAuthed = () => {
    setOpen(false);
    queryClient.invalidateQueries();
    const fn = pending.current; pending.current = undefined;
    if (fn) setTimeout(fn, 150);
  };
  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout").catch(() => {});
    setAuthToken("");
    queryClient.setQueryData(["/api/me"], null);
    queryClient.invalidateQueries();
  };
  return (
    <Ctx.Provider value={{ me: me ?? null, loading: isLoading, requireAuth, logout, openAuth }}>
      {children}
      <AuthDialog open={open} onOpenChange={setOpen} reason={reason} onAuthed={onAuthed} />
    </Ctx.Provider>
  );
}

/** Map of userId -> public profile, for tier chips next to names. */
export function useCrewIndex() {
  const { data } = useQuery<PublicUser[]>({ queryKey: ["/api/crew"] });
  return new Map((data || []).map((u) => [u.id, u]));
}

// ---------- Insignia ----------
export function tierById(id: TierId) {
  return TIERS.find((t) => t.id === id)!;
}

/** Epaulet-style insignia: stripes for Private → ATP (Restricted ATP has an outlined fourth stripe), a star for Check Airman, wings for Ancient Albatross. */
export function Insignia({ tierId, className }: { tierId: TierId; className?: string }) {
  const t = tierById(tierId);
  const bars = Array.from({ length: t.stripes });
  return (
    <svg viewBox="0 0 40 24" className={cn("h-5 w-auto", className)} aria-label={`${t.name} insignia`}>
      <rect x="1" y="1" width="38" height="22" rx="4" fill={tierId === "ancient_albatross" ? "#111827" : "#0B1222"} stroke={t.color} strokeOpacity="0.6" />
      {tierId === "student" && <path d="M14 12h12" stroke={t.color} strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />}
      {tierId !== "student" && tierId !== "ancient_albatross" &&
        bars.map((_, i) => tierId === "restricted_atp" && i === bars.length - 1
          ? <rect key={i} x="5" y={4 + i * 4.2} width="30" height="2.6" rx="0.6" fill="none" stroke={t.color} strokeWidth="0.9" /> // 4th stripe outlined: not quite full ATP
          : <rect key={i} x="5" y={4 + i * 4.2} width="30" height="2.6" rx="0.6" fill={t.color} />)}
      {tierId === "check_airman" && <path d="M33 3.2l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#fff" />}
      {tierId === "ancient_albatross" && (
        <g fill={t.color}>
          <path d="M20 9c-3-2.6-8.5-3.6-15-3 4 1.4 7 3.2 9.5 5.5L20 13l5.5-1.5C28 9.2 31 7.4 35 6c-6.5-.6-12 .4-15 3z" />
          <circle cx="20" cy="15.5" r="2.6" />
          <rect x="11" y="19" width="18" height="1.6" rx="0.5" />
        </g>
      )}
    </svg>
  );
}

const SOLO_POINTS_UI = SOLO_POINTS;
export function TierChip({ tierId, className, points }: { tierId: TierId; className?: string; points?: number }) {
  const t = tierById(tierId);
  const solo = tierId === "student" && points != null && points >= SOLO_POINTS_UI;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap bg-[#0B1222]", className)}
      style={{ borderColor: t.color + "80", color: t.color }} data-testid={`chip-tier-${tierId}`}>
      <Insignia tierId={tierId} className="h-3" />
      {t.name}{solo ? " · Solo" : ""}
    </span>
  );
}

// ---------- Posting preference ----------
export function PostAsToggle({ anonymous, onChange, name, role }: { anonymous: boolean; onChange: (a: boolean) => void; name: string; role: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5">On my ratings and listings, show</p>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-medium" role="radiogroup">
        {[false, true].map((a) => (
          <button key={String(a)} type="button" role="radio" aria-checked={anonymous === a} onClick={() => onChange(a)} data-testid={`toggle-postas-${a ? "anon" : "name"}`}
            className={cn("h-9 rounded-lg", anonymous === a ? "bg-background shadow-sm" : "text-muted-foreground")}>{a ? "Anonymous" : "My name"}</button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground" data-testid="text-postas-preview">
        Posts will read <b className="text-foreground">{publicName({ displayName: name, crewRole: role, anonymous })}</b>. You still earn points and status either way.
      </p>
    </div>
  );
}

// ---------- Sign in / sign up ----------
import { CREW_ROLES } from "@shared/schema";
const ROLES = CREW_ROLES;
const inputCls = "w-full h-11 rounded-xl border border-input bg-background px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function AuthDialog({ open, onOpenChange, reason, onAuthed }: { open: boolean; onOpenChange: (o: boolean) => void; reason?: string; onAuthed: () => void }) {
  const [mode, setMode] = useState<"signup" | "login" | "forgot">("signup");
  const [email, setEmail] = useState("");
  const [accept, setAccept] = useState(false);
  const [notice, setNotice] = useState("");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [crewRole, setRole] = useState<string>("Pilot");
  const [homeBase, setBase] = useState("");
  const [anonymous, setAnon] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast: clubToast } = useToast();
  const refId = pendingRef();
  const { data: inviterData } = useQuery<{ name: string } | null>({ queryKey: [`/api/ref/${refId}`], enabled: !!refId && mode === "signup", staleTime: 600_000, retry: false });
  const inviter = inviterData?.name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setNotice("");
    if (mode === "signup" && !accept) { setErr("Please accept the Terms and Community Guidelines"); return; }
    setBusy(true);
    try {
      if (mode === "forgot") {
        const r = await (await apiRequest("POST", "/api/auth/forgot", { email })).json();
        setNotice(r.message); setBusy(false); return;
      }
      const body = mode === "signup" ? { handle, password, displayName, crewRole, homeBase, anonymous, email, acceptTerms: true, ref: pendingRef() } : { handle, password };
      const res = await apiRequest("POST", mode === "signup" ? "/api/auth/signup" : "/api/auth/login", body);
      const { token, me } = await res.json();
      setAuthToken(token);
      queryClient.setQueryData(["/api/me"], me);
      setPassword("");
      if (mode === "signup") clearRef();
      onAuthed();
      if (mode === "signup") startTourForNewMember();
      if (mode === "signup" && me?.wrightNo) {
        clubToast({ title: `Welcome to the ${WRIGHT_NAME}`, description: `You're founding member No. ${me.wrightNo} of ${WRIGHT_SEATS}. Your badge is on your Logbook.` });
      }
    } catch (e: any) {
      const msg = String(e.message || "").replace(/^\d+:\s*/, "");
      try { setErr(JSON.parse(msg).message); } catch { setErr(msg || "Something went wrong"); }
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "signup" ? "Open your crew logbook" : mode === "login" ? "Welcome back" : "Reset your password"}</DialogTitle>
          <DialogDescription>
            {mode === "forgot" ? "Enter the email on your account and we'll send a reset link." :
              <>{reason || "Sign in to add spots, rate and vote."} Every contribution earns points toward your next rating, from Student up to Ancient Albatross.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-medium">
          {(["signup", "login"] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setErr(""); }} data-testid={`tab-auth-${m}`}
              className={cn("h-9 rounded-lg", mode === m || (m === "login" && mode === "forgot") ? "bg-background shadow-sm" : "text-muted-foreground")}>{m === "signup" ? "Create account" : "Sign in"}</button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3" data-testid="form-auth">
          {mode === "forgot" ? (
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" data-testid="input-forgot-email" className={inputCls} />
          ) : (<>
          <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder={mode === "login" ? "Handle or email" : "Handle (e.g. fo_jane)"} autoCapitalize="none" autoComplete="username" data-testid="input-auth-handle" className={inputCls} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} data-testid="input-auth-password" className={inputCls} />
          </>)}
          {mode === "login" && (
            <button type="button" onClick={() => { setMode("forgot"); setErr(""); setEmail(handle.includes("@") ? handle : ""); }} data-testid="button-forgot" className="text-xs text-primary font-medium">Forgot password?</button>
          )}
          {mode === "signup" && (
            <>
              {inviter && <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs" data-testid="text-invited-by">Invited by <span className="font-semibold">{inviter}</span>. Signing up gives them credit for the invite.</p>}
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (shown on your posts)" data-testid="input-auth-name" className={inputCls} />
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <select value={crewRole} onChange={(e) => setRole(e.target.value)} data-testid="select-auth-role" className={inputCls}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
                <input value={homeBase} onChange={(e) => setBase(e.target.value.toUpperCase().slice(0, 4))} placeholder="Base" data-testid="input-auth-base" className={cn(inputCls, "font-code uppercase")} />
              </div>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional, for password reset)" autoComplete="email" data-testid="input-auth-email" className={inputCls} />
              <PostAsToggle anonymous={anonymous} onChange={setAnon} name={displayName || "Your name"} role={crewRole} />
              <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} data-testid="checkbox-terms" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                <span>I agree to the <a href="#/terms" target="_blank" className="underline text-foreground">Terms</a>, <a href="#/guidelines" target="_blank" className="underline text-foreground">Community Guidelines</a> and <a href="#/privacy" target="_blank" className="underline text-foreground">Privacy Policy</a>.</span>
              </label>
            </>
          )}
          {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400" data-testid="text-auth-notice">{notice}</p>}
          {err && <p className="text-sm text-destructive" data-testid="text-auth-error">{err}</p>}
          <button disabled={busy} data-testid="button-auth-submit" className="w-full h-11 rounded-full taxi-sign font-semibold hover-elevate disabled:opacity-50">
            {busy ? "One moment…" : mode === "signup" ? "Create account" : mode === "login" ? "Sign in" : "Send reset link"}
          </button>
          {IS_STATIC && (
            <p className="text-xs text-muted-foreground">
              Demo: accounts live only in this browser. Try <span className="font-code">jramirez</span> / <span className="font-code">{SEED_PASSWORD}</span> to see an Ancient Albatross.
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { getAuthToken };
