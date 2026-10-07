import { apiRequest, IS_STATIC, VOTER_ID } from "@/lib/queryClient";

/** Anonymous usage counts for the admin Advertisers report. Fire-and-forget; never blocks the app. */
const send = (body: Record<string, unknown>) => {
  if (IS_STATIC) return;
  const installed = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true);
  apiRequest("POST", "/api/t", { vid: VOTER_ID, installed, ...body }).catch(() => {});
};

export function pageOf(loc: string): string | null {
  if (loc.startsWith("/admin") || loc.startsWith("/reset")) return null;
  if (loc === "/") return "home";
  if (/^\/spot\/\d+\/edit/.test(loc) || loc.startsWith("/add")) return "add";
  if (loc.startsWith("/spot/")) return "spot";
  if (loc.startsWith("/favorites")) return "favorites";
  if (loc.startsWith("/b/")) return "shared_brief";
  if (loc.startsWith("/brief")) return "brief";
  if (loc.startsWith("/crew/")) return "crew_profile";
  if (loc.startsWith("/crew")) return "crew";
  if (loc.startsWith("/follow")) return "following";
  if (loc.startsWith("/me")) return "logbook";
  if (/^\/(terms|privacy|guidelines|about)/.test(loc)) return "legal";
  return "other";
}
let last = "";
export function trackPage(loc: string) {
  const p = pageOf(loc);
  if (!p || loc === last) return;
  last = loc;
  send({ page: p });
}
export const trackOut = (kind: "website" | "map" | "phone" | "ad") => send({ out: kind });
export const trackShare = (what: "site" | "spot") => send({ share: what });
