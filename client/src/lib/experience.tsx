// Experiences: a landing page at /start lets the member pick what they came for, and the navigation is tailored to it.
// Launch switch: /api/features says whether it's open to members (app_settings experience_audience, flipped from the
// admin console). While it's "admins", only super-user accounts see /start, the tailored navs and their pages, and
// everyone else keeps the classic six-item nav. Guests always get the classic app. The choice is stored on this device.
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookUser, ClipboardList, ClipboardPlus, Contact, Heart, House, LayoutGrid, Map as MapIcon, MapPin, MessagesSquare, PlaneLanding, PlusCircle, Search, Star, Trophy, Users, type LucideIcon } from "lucide-react";
import { useAuth } from "./auth";
import { apiRequest, IS_STATIC } from "./queryClient";

export type Experience = "plan" | "spots" | "lounge";
export type NavItem = { href: string; label: string; icon: LucideIcon; active: (loc: string) => boolean; dot?: string };

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

export type Features = { experience: "admins" | "members"; trip: "admins" | "members"; ready: boolean };
/** Which parts of the app are open to members. Fails closed: if it can't load, members keep the classic app. */
export function useFeatures(): Features {
  const { data, isFetched } = useQuery<{ experience: string; trip?: string }>({
    queryKey: ["/api/features"], enabled: !IS_STATIC, staleTime: 60_000, retry: 1,
    queryFn: async () => (await apiRequest("GET", "/api/features")).json(),
  });
  return { experience: data?.experience === "members" ? "members" : "admins", trip: data?.trip === "members" ? "members" : "admins", ready: IS_STATIC || isFetched };
}
/** The new landing page and everything on it: super-user accounts always; signed-in members once it's launched. */
export function usePreview() { return usePreviewState().on; }
/** ready is false until the account and the launch switch have both loaded, so nothing redirects early. */
export function usePreviewState() {
  const { me, loading } = useAuth();
  const f = useFeatures();
  return { on: !!me && (!!me.isAdmin || f.experience === "members"), ready: !loading && (!me || !!me.isAdmin || f.ready) };
}
/** True when this account is seeing it only because it's a super-user account (shows the "admins only" badges). */
export function useAdminOnly() { const { me } = useAuth(); return useFeatures().experience !== "members" && !!me?.isAdmin; }

/**
 * Trip workflow preview (crew feedback, Oct 2026): one four-tab bar on every page (Home, Briefs, Spots, Crew), the
 * Home trip card, Crew Up from a briefing stop and AI-added listings. app_settings trip_audience; admins first.
 */
export function useTripState() {
  const { me, loading } = useAuth();
  const f = useFeatures();
  return { on: !!me && (!!me.isAdmin || f.trip === "members"), ready: !loading && (!me || !!me.isAdmin || f.ready), adminOnly: !!me?.isAdmin && f.trip !== "members" };
}
export function useTrip() { return useTripState().on; }

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
  { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications", "/settings") },
];

export const EXPERIENCE_NAV: Record<Experience, NavItem[]> = {
  plan: [
    { href: "/today", label: "Today", icon: PlaneLanding, active: on("/today") },
    { href: "/brief", label: "Briefings", icon: ClipboardList, active: (l) => l === "/brief" || (on("/brief")(l) && l !== "/brief/new") || on("/b")(l) },
    { href: "/brief/new", label: "New brief", icon: ClipboardPlus, active: (l) => l === "/brief/new" },
    { href: "/rate", label: "Rate", icon: Star, active: on("/rate") },
    { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications", "/settings") },
    SWITCH,
  ],
  spots: [
    { href: "/", label: "Search", icon: Search, active: (l) => l === "/" || l.startsWith("/spot") || l === "/map" },
    { href: "/add", label: "Add spot", icon: PlusCircle, active: on("/add") },
    { href: "/rate", label: "Rate", icon: Star, active: on("/rate") },
    { href: "/favorites", label: "Favorites", icon: Heart, active: on("/favorites") },
    { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications", "/settings") },
    SWITCH,
  ],
  lounge: [
    { href: "/lounge", label: "Lounge", icon: MessagesSquare, active: on("/lounge") },
    { href: "/meetup", label: "Crew Up", icon: Users, active: on("/meetup") },
    { href: "/mycrew", label: "My Crew", icon: Contact, active: on("/mycrew") },
    { href: "/crew", label: "Ranks", icon: Trophy, active: (l) => on("/crew", "/following", "/followers")(l) },
    { href: "/me", label: "Logbook", icon: BookUser, active: on("/me", "/notifications", "/settings") },
    SWITCH,
  ],
};

/** The four tabs. Logbook isn't here: it's the points pill in the header, on every page. */
export const TRIP_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: House, active: on("/home", "/today", "/start") },
  { href: "/brief", label: "Briefs", icon: ClipboardList, active: on("/brief", "/b") },
  { href: "/", label: "Spots", icon: MapPin, active: (l) => l === "/" || on("/spot", "/map", "/favorites", "/add", "/rate")(l) },
  { href: "/meetup", label: "Crew", icon: Users, active: on("/meetup", "/mycrew", "/lounge", "/crew", "/following", "/followers"), dot: "crew" },
];
/** Sub-tabs at the top of the Spots and Crew sections (pages that are a step of their own, like a listing or Add, have none). */
export const SPOTS_SUB: NavItem[] = [
  { href: "/", label: "Search", icon: Search, active: (l) => l === "/" },
  { href: "/map", label: "Map", icon: MapIcon, active: (l) => l === "/map" },
  { href: "/favorites", label: "Favorites", icon: Heart, active: on("/favorites") },
  { href: "/rate", label: "Rate", icon: Star, active: on("/rate") },
];
export const CREW_SUB: NavItem[] = [
  { href: "/meetup", label: "Crew Up", icon: Users, active: on("/meetup"), dot: "/meetup" },
  { href: "/mycrew", label: "My Crew", icon: Contact, active: on("/mycrew"), dot: "/mycrew" },
  { href: "/lounge", label: "Lounge", icon: MessagesSquare, active: on("/lounge") },
  { href: "/crew", label: "Ranks", icon: Trophy, active: on("/crew", "/following", "/followers") },
];
export function subTabsFor(loc: string): NavItem[] | null {
  if (SPOTS_SUB.some((n) => n.active(loc))) return SPOTS_SUB;
  if (CREW_SUB.some((n) => n.active(loc)) && !/^\/crew\/\d/.test(loc)) return CREW_SUB;
  return null;
}

/** Where each experience starts. */
export const EXPERIENCE_HOME: Record<Experience, string> = { plan: "/today", spots: "/", lounge: "/lounge" };

const ADD_SPOT: NavItem = { href: "/add", label: "Add spot", icon: PlusCircle, active: on("/add") };
/** On a trip briefing (/brief/new, /brief/:id) Add spot takes Logbook's place in the bar, so a crew building a
 *  brief can add a place they know in one tap (crew feedback #42). Logbook stays one tap away in the header. */
export function useNav(loc = ""): NavItem[] {
  const e = useExperience();
  const trip = useTrip();
  if (trip) return TRIP_NAV;
  const nav = e ? EXPERIENCE_NAV[e] : CLASSIC_NAV;
  if (!/^\/brief\/[^/]+/.test(loc) || nav.some((n) => n.href === "/add")) return nav;
  return nav.map((n) => (n.href === "/me" ? ADD_SPOT : n));
}
