import { useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Switch, Route, Router, Link, Redirect, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
// match routes on the path only, so links like #/map?route=KPDK still find /map
const useHashPath = (): [string, (to: string, opts?: { replace?: boolean }) => void] => { const [loc, nav] = useHashLocation(); return [loc.split("?")[0], nav as any]; };
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import StartPage from "@/pages/start";
import LoungePage from "@/pages/lounge";
import TodayPage from "@/pages/today";
import MeetupPage from "@/pages/meetup";
import RatePage from "@/pages/rate";
import MyCrewPage from "@/pages/mycrew";
import { useNav, usePreviewState, useTripState } from "@/lib/experience";
import TripHomePage from "@/pages/tripHome";
import { SubTabs } from "@/lib/tripNav";
import { NoticeDot } from "@/lib/notices";
import FavoritesPage from "@/pages/favorites";
import NotFound from "@/pages/not-found";
import Home, { MapRoute, SearchProvider, useSearch } from "@/pages/home";
import SpotPage from "@/pages/spot";
import AddPage from "@/pages/add";
import AdminPage from "@/pages/admin";
import ProfilePage from "@/pages/profile";
import CrewPage from "@/pages/crew";
import ResetPage from "@/pages/reset";
import LegalPage from "@/pages/legal";
import FaqPage from "@/pages/faq";
import CrewProfilePage from "@/pages/crewProfile";
import FollowingPage from "./pages/following";
import { ShareButton } from "@/lib/share";
import { trackPage } from "@/lib/metrics";
import { BriefListPage, BriefEditorPage, SharedBriefPage } from "@/pages/brief";
import { AuthProvider, useAuth, Insignia } from "@/lib/auth";
import { CrewAvatar } from "@/lib/aircraft";
import { tierFor } from "@shared/tiers";
import { TabDot } from "@/lib/tabDots";
import NotificationsPage from "@/pages/notifications";
import SettingsPage from "@/pages/settings";
import { PushHost, PushPrompt } from "@/lib/push";
import { useUnreadCount } from "@/lib/notices";
import { Logo, ThemeProvider, ThemeToggle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { FeedbackLink } from "@/lib/feedback";
import { TourHost, TourLink } from "@/lib/tour";
import { SiteFooter } from "@/lib/footer";
import { UpdateBar } from "@/lib/update";
import { WhatsNewHost } from "@/lib/whatsNew";
import { IS_STATIC } from "@/lib/queryClient";

function Shell() {
  const [loc] = useLocation();
  useEffect(() => { trackPage(loc); }, [loc]);
  const [, setSearch] = useSearch();
  const { me, openAuth } = useAuth();
  const unread = useUnreadCount();
  const isAdmin = loc.startsWith("/admin");
  // New page starts at the top (home keeps its own scroll for browse mode)
  useEffect(() => { if (loc !== "/") window.scrollTo(0, 0); }, [loc]);
  // members: the classic six-item nav; admins previewing an experience get a nav tailored to it (lib/experience.tsx)
  const { on: landing, ready: landingReady } = usePreviewState();
  const nav = useNav(loc).map((n) => ({ ...n, active: n.active(loc) }));
  // four-tab layout (trip preview): Home is the hub, the logo and app start go there, Logbook is the header pill
  const { on: trip, ready: tripReady } = useTripState();
  const homeHref = trip ? "/" : landing ? "/start" : "/";
  // the new landing page: once per visit, a signed-in member opening the app at home starts on /start
  const [, go] = useLocation();
  useEffect(() => {
    if (!landingReady || !tripReady || !landing || trip) return; // the trip preview opens on Home (Spots search) itself
    let seen = false;
    try { seen = sessionStorage.getItem("wheelsdown-landed") === "1"; sessionStorage.setItem("wheelsdown-landed", "1"); } catch { /* private mode */ }
    const deep = window.location.search.length > 1 || (window.location.hash.split("?")[1] || "").length > 0;
    if (!seen && loc === "/" && !deep) go(trip ? "/today" : "/start", { replace: true });
  }, [landingReady, landing, tripReady, trip]); // eslint-disable-line
  // the landing page has no navigation at all
  if ((loc === "/start" || loc === "/home") && trip) return <Redirect to="/" replace />;
  if (loc === "/start") return (<><StartPage /><TourHost /><UpdateBar /><WhatsNewHost /><PushHost unread={unread} /><PushPrompt /></>);
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="print:hidden sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur pt-safe-top px-safe">
        <div className={cn("mx-auto flex h-14 items-center justify-between px-4", isAdmin ? "max-w-6xl" : "max-w-xl")}>
          <Link href={homeHref} onClick={() => setSearch({ category: null })} data-testid="link-home" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-base font-semibold tracking-tight">Wheels<span className="text-primary">down</span></span>
            {IS_STATIC && <span className="rounded border border-primary/50 px-1 font-code text-[10px] font-bold text-primary" data-testid="badge-demo">DEMO</span>}
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-label={n.label} data-testid={`link-nav-${n.label}`}
                className={cn("whitespace-nowrap hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 lg:px-3 h-9 text-sm font-medium hover-elevate", n.active ? "text-foreground" : "text-muted-foreground")}>
                <span className="relative"><n.icon className="h-4 w-4" /><TabDot href={n.dot || n.href} /></span><span className="hidden lg:inline">{n.label}</span>
              </Link>
            ))}
            <ShareButton />
            <ThemeToggle />
            {me ? (
              <Link href="/me" data-testid="link-me" aria-label="Logbook" className="relative ml-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card pl-1.5 pr-2.5 h-9 hover-elevate">
                {me.aircraft ? <CrewAvatar aircraft={me.aircraft} className="h-6 w-6" /> : <Insignia tierId={me.tierId} className="h-4" />}
                <span className="font-code text-xs font-bold tabular">{me.points.toLocaleString()}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground">{tierFor(me.points).tier.name}</span>
                {trip && <NoticeDot />}
              </Link>
            ) : (
              <button onClick={() => openAuth()} data-testid="button-signin" className="ml-1 h-9 whitespace-nowrap rounded-full taxi-sign px-3.5 text-sm font-semibold hover-elevate">Sign in</button>
            )}
          </nav>
        </div>
      </header>

      <main className={cn("mx-auto w-full flex-1 px-4 pt-5 pb-28 sm:pb-12", isAdmin ? "max-w-6xl" : "max-w-xl")}>
        <ErrorBoundary resetKey={loc}>
        {trip && <SubTabs />}
        <Switch>
          <Route path="/plan" component={TripHomePage} />
          <Route path="/" component={Home} />
          <Route path="/map" component={MapRoute} />
          <Route path="/spot/:id/edit" component={AddPage} />
          <Route path="/spot/:id" component={SpotPage} />
          <Route path="/favorites" component={FavoritesPage} />
          <Route path="/add" component={AddPage} />
          <Route path="/add/:icao" component={AddPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/me" component={ProfilePage} />
          <Route path="/notifications" component={NotificationsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/crew" component={CrewPage} />
          <Route path="/following" component={FollowingPage} />
          <Route path="/followers" component={FollowingPage} />
          <Route path="/crew/:id" component={CrewProfilePage} />
          <Route path="/brief" component={BriefListPage} />
          <Route path="/brief/new" component={BriefEditorPage} />
          <Route path="/brief/:id" component={BriefEditorPage} />
          <Route path="/b/:token" component={SharedBriefPage} />
          <Route path="/reset/:token" component={ResetPage} />
          <Route path="/faq" component={FaqPage} />
          <Route path="/lounge" component={LoungePage} />
          <Route path="/today" component={TodayPage} />
          <Route path="/meetup" component={MeetupPage} />
          <Route path="/rate" component={RatePage} />
          <Route path="/mycrew" component={MyCrewPage} />
          <Route path="/terms" component={LegalPage} />
          <Route path="/privacy" component={LegalPage} />
          <Route path="/guidelines" component={LegalPage} />
          <Route path="/about" component={LegalPage} />
          <Route component={NotFound} />
        </Switch>
        </ErrorBoundary>
        {!isAdmin && (
          <SiteFooter className="mt-12" />
        )}
      </main>
      <TourHost />
      <UpdateBar />
      <PushHost unread={unread} />
      <PushPrompt />
      <WhatsNewHost />

      {/* iOS-style tab bar */}
      {!isAdmin && (
        <nav className="tabbar print:hidden sm:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/90 backdrop-blur pb-safe" data-testid="nav-tabbar">
          <div className="mx-auto max-w-xl grid px-safe" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
            {nav.map((n) => (
              <Link key={n.href} href={n.href} data-testid={`tab-${n.label}`} className={cn("flex min-w-0 flex-col items-center gap-0.5 pt-2 pb-1 text-[10px] font-medium tracking-tight", n.active ? "text-primary" : "text-muted-foreground")}>
                <span className="relative"><n.icon className="h-5 w-5" /><TabDot href={n.dot || n.href} /></span><span className="truncate max-w-full">{n.label}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SearchProvider>
            <Toaster />
            <AuthProvider>
              <Router hook={useHashPath}>
                <Shell />
              </Router>
            </AuthProvider>
          </SearchProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
