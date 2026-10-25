import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, TicketPercent, ClipboardList, Megaphone, QrCode, Users, Building2, UserCog, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; short: string; icon: LucideIcon; hint: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  { label: "", items: [{ to: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard, hint: "Your page at a glance" }] },
  { label: "For your crews", items: [
    { to: "/places", label: "Recommendations", short: "Picks", icon: UtensilsCrossed, hint: "Restaurants, hotels and things to do" },
    { to: "/offers", label: "Discounts", short: "Deals", icon: TicketPercent, hint: "Crew codes and coupons" },
    { to: "/intel", label: "FBO intel", short: "Intel", icon: ClipboardList, hint: "Hours, crew car, parking and more" },
  ] },
  { label: "Get it in front of crews", items: [
    { to: "/qr", label: "QR & print", short: "QR", icon: QrCode, hint: "Counter sign, lounge sign, cards, kiosk" },
    { to: "/ads", label: "Ads", short: "Ads", icon: Megaphone, hint: "Sponsored text ads in the crew app" },
  ] },
  { label: "Your account", items: [
    { to: "/team", label: "Team", short: "Team", icon: Users, hint: "Who at your FBO can sign in" },
    { to: "/profile", label: "FBO profile", short: "Profile", icon: Building2, hint: "Name, logo and contact on your page" },
  ] },
];
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
const ACCOUNT: NavItem = { to: "/account", label: "My login", short: "Login", icon: UserCog, hint: "Your name, email and password" };

/** Page the back button falls back to when there is no earlier portal page in this tab. */
const PARENT: Record<string, string> = { "/print": "/qr", "/account": "/" };
export const parentOf = (path: string) => {
  const hit = Object.keys(PARENT).find((p) => path.startsWith(p));
  if (hit) return PARENT[hit];
  return path === "/" ? null : "/";
};
export const navItemFor = (path: string): NavItem | undefined =>
  path === "/account" ? ACCOUNT : NAV.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));

// Pages visited in this tab, so Back only steps through browser history when the previous entry is ours.
const stack: string[] = [];
export function useTrackNav() {
  const [loc] = useLocation();
  useEffect(() => {
    if (stack[stack.length - 1] === loc) return;
    if (stack[stack.length - 2] === loc) stack.pop(); else stack.push(loc);
    window.scrollTo({ top: 0 });
  }, [loc]);
}
export function useBack() {
  const [loc, navigate] = useLocation();
  return (fallback?: string) => {
    if (stack.length > 1 && stack[stack.length - 1] === loc) { window.history.back(); return; }
    stack.length = 0;
    navigate(fallback ?? parentOf(loc) ?? "/", { replace: true });
  };
}
export const backLabel = (path: string) => {
  // Render runs before the tracking effect, so the stack may not include this page yet.
  const s = stack[stack.length - 1] === path ? stack.slice(0, -1) : stack[stack.length - 2] === path ? stack.slice(0, -2) : stack;
  const prev = s.length ? s[s.length - 1] : parentOf(path);
  return prev ? (navItemFor(prev.split("?")[0])?.label ?? "Back") : "Back";
};
export function useIsNarrow() {
  const q = "(max-width: 1023px)";
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setN(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return n;
}
