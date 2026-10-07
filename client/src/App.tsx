import { useEffect } from "react";
import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Search, PlusCircle, Shield, Trophy, BookUser, ClipboardList, Heart } from "lucide-react";
import FavoritesPage from "@/pages/favorites";
import NotFound from "@/pages/not-found";
import Home, { SearchProvider, useSearch } from "@/pages/home";
import SpotPage from "@/pages/spot";
import AddPage from "@/pages/add";
import AdminPage from "@/pages/admin";
import ProfilePage from "@/pages/profile";
import CrewPage from "@/pages/crew";
import ResetPage from "@/pages/reset";
import LegalPage from "@/pages/legal";
import CrewProfilePage from "@/pages/crewProfile";
import FollowingPage from "./pages/following";
import { ShareButton } from "@/lib/share";
import { trackPage } from "@/lib/metrics";
import { BriefListPage, BriefEditorPage, SharedBriefPage } from "@/pages/brief";
import { AuthProvider, useAuth, Insignia } from "@/lib/auth";
import { CrewAvatar } from "@/lib/aircraft";
import { tierFor } from "@shared/tiers";
import { NoticeDot } from "@/lib/notices";
import { Logo, ThemeProvider, ThemeToggle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { FeedbackLink } from "@/lib/feedback";
import { IS_STATIC } from "@/lib/queryClient";

function Shell() {
  const [loc] = useLocation();
  useEffect(() => { trackPage(loc); }, [loc]);
  const [, setSearch] = useSearch();
  const { me, openAuth } = useAuth();
  const isAdmin = loc.startsWith("/admin");
  // New page starts at the top (home keeps its own scroll for browse mode)
  useEffect(() => { if (loc !== "/") window.scrollTo(0, 0); }, [loc]);
  const nav = [
    { href: "/", label: "Search", icon: Search, active: loc === "/" || loc.startsWith("/spot") },
    { href: "/add", label: "Add spot", icon: PlusCircle, active: loc.startsWith("/add") },
    { href: "/favorites", label: "Favorites", icon: Heart, active: loc.startsWith("/favorites") },
    { href: "/brief", label: "Brief", icon: ClipboardList, active: loc.startsWith("/brief") || loc.startsWith("/b/") },
    { href: "/crew", label: "Crew", icon: Trophy, active: loc.startsWith("/crew") },
    { href: "/me", label: "Logbook", icon: BookUser, active: loc.startsWith("/me") },
  ];
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="print:hidden sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur pt-safe-top px-safe">
        <div className={cn("mx-auto flex h-14 items-center justify-between px-4", isAdmin ? "max-w-6xl" : "max-w-xl")}>
          <Link href="/" onClick={() => setSearch({ category: null })} data-testid="link-home" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-base font-semibold tracking-tight">Wheels<span className="text-primary">down</span></span>
            {IS_STATIC && <span className="rounded border border-primary/50 px-1 font-code text-[10px] font-bold text-primary" data-testid="badge-demo">DEMO</span>}
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-label={n.label} data-testid={`link-nav-${n.label}`}
                className={cn("whitespace-nowrap hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 lg:px-3 h-9 text-sm font-medium hover-elevate", n.active ? "text-foreground" : "text-muted-foreground")}>
                <span className="relative"><n.icon className="h-4 w-4" />{n.href === "/me" && <NoticeDot />}</span><span className="hidden lg:inline">{n.label}</span>
              </Link>
            ))}
            <ShareButton />
            <ThemeToggle />
            {me ? (
              <Link href="/me" data-testid="link-me" className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card pl-1.5 pr-2.5 h-9 hover-elevate">
                {me.aircraft ? <CrewAvatar aircraft={me.aircraft} className="h-6 w-6" /> : <Insignia tierId={me.tierId} className="h-4" />}
                <span className="font-code text-xs font-bold tabular">{me.points.toLocaleString()}</span>
                <span className="hidden sm:inline text-xs text-muted-foreground">{tierFor(me.points).tier.name}</span>
              </Link>
            ) : (
              <button onClick={() => openAuth()} data-testid="button-signin" className="ml-1 h-9 whitespace-nowrap rounded-full taxi-sign px-3.5 text-sm font-semibold hover-elevate">Sign in</button>
            )}
          </nav>
        </div>
      </header>

      <main className={cn("mx-auto w-full flex-1 px-4 pt-5 pb-28 sm:pb-12", isAdmin ? "max-w-6xl" : "max-w-xl")}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/spot/:id/edit" component={AddPage} />
          <Route path="/spot/:id" component={SpotPage} />
          <Route path="/favorites" component={FavoritesPage} />
          <Route path="/add" component={AddPage} />
          <Route path="/add/:icao" component={AddPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/me" component={ProfilePage} />
          <Route path="/crew" component={CrewPage} />
          <Route path="/following" component={FollowingPage} />
          <Route path="/followers" component={FollowingPage} />
          <Route path="/crew/:id" component={CrewProfilePage} />
          <Route path="/brief" component={BriefListPage} />
          <Route path="/brief/new" component={BriefEditorPage} />
          <Route path="/brief/:id" component={BriefEditorPage} />
          <Route path="/b/:token" component={SharedBriefPage} />
          <Route path="/reset/:token" component={ResetPage} />
          <Route path="/terms" component={LegalPage} />
          <Route path="/privacy" component={LegalPage} />
          <Route path="/guidelines" component={LegalPage} />
          <Route path="/about" component={LegalPage} />
          <Route component={NotFound} />
        </Switch>
        {!isAdmin && (
          <footer className="print:hidden mt-12 space-y-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <p>{IS_STATIC ? "Demo build: sample data, and your additions are saved only in this browser." : "Crew-sourced. Verify hours and prices before you go."}</p>
              <Link href="/admin" data-testid="link-admin" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"><Shield className="h-3.5 w-3.5" />Admin</Link>
            </div>
            <nav className="flex flex-wrap gap-x-4 gap-y-1" data-testid="nav-legal">
              <Link href="/about" className="hover:text-foreground">About & Advertise</Link>
              <Link href="/guidelines" className="hover:text-foreground">Guidelines</Link>
              <Link href="/terms" className="hover:text-foreground">Terms</Link>
              <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
              <FeedbackLink className="font-semibold text-foreground hover:text-primary" />
            </nav>
          </footer>
        )}
      </main>

      {/* iOS-style tab bar */}
      {!isAdmin && (
        <nav className="print:hidden sm:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/90 backdrop-blur pb-safe">
          <div className="mx-auto max-w-xl grid grid-cols-6 px-safe">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} data-testid={`tab-${n.label}`} className={cn("flex min-w-0 flex-col items-center gap-0.5 pt-2 pb-1 text-[10px] font-medium tracking-tight", n.active ? "text-primary" : "text-muted-foreground")}>
                <span className="relative"><n.icon className="h-5 w-5" />{n.href === "/me" && <NoticeDot />}</span><span className="truncate max-w-full">{n.label}</span>
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
              <Router hook={useHashLocation}>
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
