// Experiences (admin preview): a landing page at /start lets the member pick what they came for, and the navigation
// is tailored to that choice. Hidden from members for now: only super-user accounts see /start or a tailored nav;
// everyone else keeps the classic six-item nav. The choice is stored on this device only.
import { useSyncExternalStore } from "react";
import { BookUser, ClipboardList, ClipboardPlus, Heart, LayoutGrid, MessagesSquare, PlusCircle, Search, Trophy, type LucideIcon } from "lucide-react";
import { useAuth } from "./auth";

export type Experience = "plan" | "spots" | "lounge";
export type NavItem = { href: string; label: string; icon: LucideIcon; active: (loc: string) => boolean };

const KEY = "wheelsdown-experience";
const EVENT = "wheelsdown:experience";
const isExp = (v: unknown): v is Experience => v === "plan" || v === "spots" || v === "lounge";
const read = (): Experience | null => { try { const v = localStorage.getItem(KEY); return isExp(v) ? v : null; } catch { return null; } };

export function setExperience(e: Experience | null) {
  try { e ? localStorage.setItem(KEY, e) : localStorage.removeItem(KEY); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb); window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
};

/** The admin preview is on for super-user accounts only. */
export function usePreview() { const { me } = useAuth(); return !!me?.isAdmin; }

/** Current experience, or null for the classic app (always null for members). */
export function useExperience(): Experience | null {
  const preview = usePreview();
  const e = useSyncExternalStore(subscribe, read, () => null);
  return preview ? e : null;
}

const on = (...p: string[]) => (loc: string) => p.some((x) => (x === "/" ? loc === "/" : loc === x || loc.startsWith(`${x}/`)));
const SWITCH: NavItem = { href: "/start", label: "Switch", icon: LayoutGrid, active: on("/start") };

/** Six items, exactly as members see it today. */
export const CLASSIC_NAV: NavItem[] = [
  { href: "/", label: "Search", icon: Search, active: (l) => l === "/" || l.startsWith("/spot") },
  { href: "/add", label: "Add spot", icon: PlusCircle, active: on("/add") },
  { href: "/favorites", label: "Favorites", icon: Heart, active: on("/favorites") },
  { href: "/brief", label: "Brief", icon: ClipboardList, active: (l) => on("/brief", "/b")(l) },
  { href: "/crew", label: "Crew", icon: Trophy, active: on("/crew") },
  { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications") },
];

export const EXPERIENCE_NAV: Record<Experience, NavItem[]> = {
  plan: [
    { href: "/brief", label: "Briefings", icon: ClipboardList, active: (l) => l === "/brief" || (on("/brief")(l) && l !== "/brief/new") || on("/b")(l) },
    { href: "/brief/new", label: "New brief", icon: ClipboardPlus, active: (l) => l === "/brief/new" },
    { href: "/favorites", label: "Favorites", icon: Heart, active: on("/favorites") },
    { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications") },
    SWITCH,
  ],
  spots: [
    { href: "/", label: "Search", icon: Search, active: (l) => l === "/" || l.startsWith("/spot") || l === "/map" },
    { href: "/add", label: "Add spot", icon: PlusCircle, active: on("/add") },
    { href: "/favorites", label: "Favorites", icon: Heart, active: on("/favorites") },
    { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications") },
    SWITCH,
  ],
  lounge: [
    { href: "/lounge", label: "Lounge", icon: MessagesSquare, active: on("/lounge") },
    { href: "/crew", label: "Crew", icon: Trophy, active: on("/crew", "/following", "/followers") },
    { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications") },
    SWITCH,
  ],
};

/** Where each experience starts. */
export const EXPERIENCE_HOME: Record<Experience, string> = { plan: "/brief", spots: "/", lounge: "/lounge" };

export function useNav(): NavItem[] {
  const e = useExperience();
  return e ? EXPERIENCE_NAV[e] : CLASSIC_NAV;
}
