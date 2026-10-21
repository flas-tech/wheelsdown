// Sub-tabs at the top of the Spots and Crew sections in the four-tab layout (lib/experience.tsx TRIP_NAV).
// One row of pills, the current one filled; Spots also has an Add button on the right.
import { Link, useLocation } from "wouter";
import { Plus } from "lucide-react";
import { SPOTS_SUB, subTabsFor } from "@/lib/experience";
import { TabDot } from "@/lib/tabDots";
import { cn } from "@/lib/utils";
import { useSearch } from "@/pages/home";

export function SubTabs() {
  const [loc, go] = useLocation();
  const [search, setSearch] = useSearch();
  const tabs = subTabsFor(loc);
  if (!tabs) return null;
  const spots = tabs === SPOTS_SUB;
  // Search and Map are the same page (Search keeps its list/map toggle); these tabs just pick the view
  const isActive = (t: (typeof tabs)[number]) => (t.href === "/" ? loc === "/" && search.view !== "map" : t.href === "/map" ? loc === "/" && search.view === "map" : t.active(loc));
  const onTab = (t: (typeof tabs)[number]) => (e: React.MouseEvent) => {
    if (t.href === "/") { e.preventDefault(); setSearch({ view: "list", focus: null }); go("/"); }
    else if (t.href === "/map") { e.preventDefault(); setSearch({ category: search.category || "eat", browse: true, view: "map", focus: null }); go("/"); }
  };
  return (
    <div className="print:hidden mb-4 flex items-center gap-2" data-testid={`subtabs-${spots ? "spots" : "crew"}`}>
      <div className="grid min-w-0 flex-1 grid-cols-4 gap-0.5 rounded-full border border-border bg-muted/60 p-0.5" role="tablist" aria-label={spots ? "Spots" : "Crew"}>
        {tabs.map((t) => {
          const active = isActive(t);
          return (
            <Link key={t.href} href={t.href} onClick={onTab(t)} role="tab" aria-selected={active} data-testid={`subtab-${t.label}`}
              className={cn("relative flex h-9 min-w-0 items-center justify-center rounded-full px-1 text-[13px] font-semibold",
                active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover-elevate")}>
              <span className="relative whitespace-nowrap">{t.label}{t.dot && <TabDot href={t.dot} />}</span>
            </Link>
          );
        })}
      </div>
      {spots && (
        <Link href="/add" aria-label="Add a spot" data-testid="subtab-add" className="grid h-10 w-10 shrink-0 place-items-center rounded-full taxi-sign hover-elevate">
          <Plus className="h-5 w-5" />
        </Link>
      )}
    </div>
  );
}

/** Hours a Crew Up plan lasts for each layover type. */
export const CREWUP_HOURS: Record<string, number> = { quick: 2, hours: 4, overnight: 12, multi: 24 };
/** Crew Up at a briefing stop: the airport, and the arrival date/time (airport local) when the stop has them. */
export function crewUpHref(st: { icao: string; layover: string; arriveDate?: string | null; arriveTime?: string | null }) {
  const q = new URLSearchParams({ icao: st.icao, hours: String(CREWUP_HOURS[st.layover] ?? 12) });
  if (st.arriveDate) q.set("date", st.arriveDate);
  if (st.arriveDate && st.arriveTime) q.set("time", st.arriveTime);
  return `/meetup?${q.toString()}`;
}
/** Read once from the address: what Crew Up should fill in. */
export function crewUpPrefill() {
  const q = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
  const date = q.get("date"), time = q.get("time"), hours = Number(q.get("hours")) || null;
  return { date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, time: time && /^\d{2}:\d{2}$/.test(time) ? time : null, hours };
}

export type TripStop = {
  briefId: number; title: string; stopIndex: number; icao: string; place: string; arriveDate: string | null; arriveTime: string | null;
  layover: string; nights: number | null; when: "upcoming" | "now" | "past" | "undated";
  steps: { picks: number; aiOn: boolean; added: boolean; rated: number; toRate: number[] };
};
export type TripResp = { next: TripStop | null; rate: TripStop | null; later: TripStop[]; briefCount: number };
/** "Thu, Oct 23 · 2:30 PM local" from the stop's local date and time. */
export function fmtArrive(s: { arriveDate?: string | null; arriveTime?: string | null }) {
  if (!s.arriveDate) return "";
  const d = new Date(`${s.arriveDate}T12:00:00Z`);
  const day = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(d);
  if (!s.arriveTime) return day;
  const [h, m] = s.arriveTime.split(":").map(Number);
  const t = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(Date.UTC(2000, 0, 1, h, m));
  return `${day} · ${t} local`;
}
