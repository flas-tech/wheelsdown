// Settings: everything you set once, moved off the Logbook (gear at the top of the Logbook). The Logbook keeps
// points, badges, your map, check-ins, invites and feedback.
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ChevronRight, CircleHelp, Compass, LogOut, Shield } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NotificationSettings } from "@/lib/push";
import { AiPrefCard, ProgramsCard } from "@/lib/aiPicks";
import { VersionCard } from "@/lib/version";
import { TourLink } from "@/lib/tour";
import { DeleteAccount, PreviewCard, ProfileSettings } from "@/pages/profile";

const row = "flex items-center justify-between gap-3 rounded-2xl border border-card-border bg-card px-4 py-3 hover-elevate";

export default function SettingsPage() {
  const { me, loading, logout, openAuth } = useAuth();
  const [, navigate] = useLocation();
  // /settings?focus=pf-aircraft (from Finish your profile on the Logbook) or #notifications: jump to that field
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
    const id = q.get("focus") || (q.get("s") === "push" ? "notifications" : null);
    if (!id) return;
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const f = el.querySelector<HTMLElement>("input, textarea");
      setTimeout(() => f?.focus({ preventScroll: true }), 400);
    }, 350);
    return () => clearTimeout(t);
  }, [me?.id]);

  if (loading) return null;
  if (!me) return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-muted-foreground">Sign in to see your settings.</p>
      <button onClick={() => openAuth()} className="h-11 rounded-full taxi-sign px-6 font-semibold hover-elevate" data-testid="button-settings-signin">Sign in</button>
    </div>
  );
  return (
    <div className="space-y-5" data-testid="page-settings">
      <div>
        <Link href="/me" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-settings-back"><ArrowLeft className="h-4 w-4" />Logbook</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      <NotificationSettings />
      <ProfileSettings />
      <AiPrefCard />
      <ProgramsCard />

      <Link href="/mycrew?tab=privacy" className={row} data-testid="link-settings-crew-privacy">
        <span className="flex items-center gap-3"><Shield className="h-5 w-5 text-primary" /><span><span className="block text-sm font-semibold">My Crew privacy</span><span className="block text-xs text-muted-foreground">What your crew sees, and who can send you requests</span></span></span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <PreviewCard />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">App</h2>
        <VersionCard />
        <Link href="/faq" className={row} data-testid="link-settings-faq">
          <span className="flex items-center gap-3"><CircleHelp className="h-5 w-5 text-primary" /><span><span className="block text-sm font-semibold">Questions and answers</span><span className="block text-xs text-muted-foreground">Points, ratings, AI picks, briefings, privacy</span></span></span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <p className="flex items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground"><Compass className="h-3.5 w-3.5" />New here, or forgot where something is? <TourLink className="font-semibold text-foreground underline hover:text-primary" /></p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Account</h2>
        <button onClick={async () => { await logout(); navigate("/"); }} data-testid="button-logout" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium hover-elevate"><LogOut className="h-4 w-4" />Sign out</button>
        <DeleteAccount />
      </section>
    </div>
  );
}
