// Four-tab layout: "Plan your layover" and "Trip briefings" were the same thing, so they are one page now,
// Trip sheets (/brief). This file holds its top half (new trip sheet, Coming up, a trip to rate) and the
// Crew Up plan list that also shows on each trip sheet stop. /plan just forwards to /brief.
// It must not import pages/brief.tsx (brief.tsx imports this).
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { CalendarPlus, ChevronRight, Star, Users } from "lucide-react";
import type { Meetup } from "@shared/layover";
import { useTripState } from "@/lib/experience";
import { fmtArrive, type TripResp } from "@/lib/tripNav";
import { cn } from "@/lib/utils";

export default function TripHomePage() {
  const [, go] = useLocation();
  useEffect(() => { go("/brief", { replace: true }); }, []); // eslint-disable-line
  return null;
}

export const fmtPlanWhen = (m: { startsAt: number; tz: string | null }) =>
  new Intl.DateTimeFormat(undefined, { timeZone: m.tz || undefined, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(m.startsAt);
const dayAt = (tz: string | null, t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);

/** Crew Up plans as compact rows that open the plan in Crew Up. `onDate` highlights plans on that local date. */
export function CrewPlanRows({ plans, onDate, testId }: { plans: Meetup[]; onDate?: string | null; testId?: string }) {
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {plans.map((m) => {
        const hit = !!onDate && dayAt(m.tz, m.startsAt) === onDate;
        const where = m.spot?.name || m.place || "";
        const who = m.mine ? "Your plan" : m.host.name;
        const going = m.mine ? `${m.joins} in` : m.joined ? "You're in" : `${m.joins + 1} in`;
        return (
          <li key={m.id}>
            <Link href={`/meetup?icao=${m.icao}&plan=${m.id}`} className={cn("flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2 hover-elevate", hit ? "border-primary/60 bg-primary/5" : "border-border")} data-testid={`link-crewplan-${m.id}`}>
              <Users className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{who}{where ? ` · ${where}` : ""}</span>
                <span className="block truncate text-[11px] text-muted-foreground"><span className="font-code">{m.icao}</span> · {fmtPlanWhen(m)}{m.note ? ` · ${m.note}` : ""}</span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", m.joined || m.mine ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{going}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Top of Trip sheets: new trip sheet and a trip to rate. Your trip sheets follow, then Crew plans. */
export function TripSheetTop() {
  const { on, adminOnly } = useTripState();
  const { data } = useQuery<TripResp>({ queryKey: ["/api/preview/trip"], enabled: on, staleTime: 30_000, retry: false });
  if (!on) return null;
  return (
    <div className="space-y-5" data-testid="page-plan">
      {adminOnly && <span className="inline-flex items-center rounded-full border border-dashed border-primary/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary" data-testid="badge-trip-preview">Preview · admins only</span>}
      <Link href="/brief/new" className="flex h-12 w-full items-center justify-center gap-2 rounded-full taxi-sign text-base font-semibold hover-elevate" data-testid="button-plan-new">
        <CalendarPlus className="h-5 w-5" />New trip sheet
      </Link>

      {data?.rate && (
        <Link href="/rate" className="flex items-center gap-3 rounded-2xl border border-primary/50 bg-primary/5 p-4 hover-elevate" data-testid="card-plan-rate">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15"><Star className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">How was <span className="font-code">{data.rate.icao}</span>?</span>
            <span className="block text-xs text-muted-foreground">Rate {data.rate.steps.toRate.length} place{data.rate.steps.toRate.length === 1 ? "" : "s"} from that trip. Your ratings help the next crew.</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      )}
    </div>
  );
}

/** Under your trip sheets: Crew Up plans you can see (yours and the ones crew picked you for). */
export function CrewPlansSection() {
  const { on } = useTripState();
  const { data: cp } = useQuery<{ plans: Meetup[] }>({ queryKey: ["/api/preview/crewup-all"], enabled: on, staleTime: 30_000, retry: false });
  if (!on || !cp?.plans.length) return null;
  return (
    <section className="space-y-2" data-testid="section-plan-crewplans">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Crew plans</h2>
      <CrewPlanRows plans={cp.plans.slice(0, 4)} />
      {cp.plans.length > 4 && <Link href="/meetup?tab=plans" className="block text-center text-xs font-semibold underline underline-offset-2" data-testid="link-plan-crewplans-all">All {cp.plans.length} plans in Crew Up</Link>}
    </section>
  );
}

/** Bottom of Home: each trip sheet still ahead, with all its cities. Tapping one opens the trip sheet. */
export function ComingUpTrips() {
  const { on } = useTripState();
  const { data } = useQuery<TripResp>({ queryKey: ["/api/preview/trip"], enabled: on, staleTime: 30_000, retry: false });
  if (!on || !data?.coming.length) return null;
  const sheets: { id: number; title: string; stops: TripResp["coming"] }[] = [];
  for (const s of data.coming) {
    let g = sheets.find((x) => x.id === s.briefId);
    if (!g) sheets.push((g = { id: s.briefId, title: s.title, stops: [] }));
    g.stops.push(s);
  }
  for (const g of sheets) g.stops.sort((a, b) => a.stopIndex - b.stopIndex);
  return (
    <section className="space-y-2" data-testid="section-home-coming">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coming up</h2>
      <ul className="space-y-2">
        {sheets.map((g) => (
          <li key={g.id}>
            <Link href={`/brief/${g.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 hover-elevate" data-testid={`link-home-coming-${g.id}`}>
              <span className="min-w-0 flex-1 space-y-1">
                {g.title && <span className="block truncate text-sm font-semibold">{g.title}</span>}
                {g.stops.map((s) => (
                  <span key={s.stopIndex} className="flex min-w-0 items-baseline gap-2 text-xs">
                    <span className="font-code font-bold">{s.icao}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.place}</span>
                    <span className={cn("shrink-0", s.when === "now" ? "font-semibold text-primary" : "text-muted-foreground")}>{s.when === "now" ? "Today" : s.arriveDate ? fmtArrive(s) : "No date"}</span>
                  </span>
                ))}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
