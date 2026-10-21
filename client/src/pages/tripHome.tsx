// Plan (four-tab layout): plan your layover. Coming up from your briefs (on now, then by landing date, then
// undated stops in the order you planned them), a button to plan another, a trip to rate, and At the field now.
// Nothing here is required: Home (Layover today) and Spots work without a brief.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { CalendarPlus, ChevronRight, Loader2, PlaneLanding, Star, Users } from "lucide-react";
import { useTripState } from "@/lib/experience";
import { crewUpHref, fmtArrive, type TripResp } from "@/lib/tripNav";
import { cn } from "@/lib/utils";

export default function TripHomePage() {
  const { on, ready, adminOnly } = useTripState();
  const [, go] = useLocation();
  useEffect(() => { if (ready && !on) go("/brief", { replace: true }); }, [ready, on]); // eslint-disable-line
  const { data, isLoading } = useQuery<TripResp>({ queryKey: ["/api/preview/trip"], enabled: on, staleTime: 30_000, retry: false });
  if (!on) return null;

  return (
    <div className="space-y-5" data-testid="page-plan">
      <header className="space-y-1">
        {adminOnly && <span className="mb-1 inline-flex items-center rounded-full border border-dashed border-primary/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary" data-testid="badge-trip-preview">Preview · admins only</span>}
        <h1 className="text-xl font-semibold">Plan your layover</h1>
        <p className="text-sm text-muted-foreground">Pick the airports and the app picks crew-rated places for each stop.</p>
      </header>

      <Link href="/brief/new" className="flex h-12 w-full items-center justify-center gap-2 rounded-full taxi-sign text-base font-semibold hover-elevate" data-testid="button-plan-new">
        <CalendarPlus className="h-5 w-5" />Plan a layover
      </Link>

      <section className="space-y-2" data-testid="section-plan-coming">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coming up</h2>
          {!!data?.briefCount && <Link href="/brief" className="text-xs font-semibold text-foreground underline underline-offset-2" data-testid="link-plan-all">All briefs ({data.briefCount})</Link>}
        </div>
        {isLoading ? <div className="grid place-items-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          : !data?.coming.length ? <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-plan-none">Nothing planned yet. Plan a layover and it shows here.</p>
          : (
            <ul className="space-y-2">
              {data.coming.map((s) => (
                <li key={`${s.briefId}-${s.stopIndex}`} className="flex items-center gap-2">
                  <Link href={`/brief/${s.briefId}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 hover-elevate" data-testid={`link-plan-stop-${s.icao}`}>
                    <span className="font-code text-sm font-bold">{s.icao}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-xs font-medium", s.when === "now" && "text-primary")}>{s.when === "now" ? "On this trip" : s.arriveDate ? fmtArrive(s) : "No date"}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{s.place}{s.title ? ` · ${s.title}` : ""}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                  <Link href={crewUpHref(s)} aria-label={`Crew Up at ${s.icao}`} title={`Crew Up at ${s.icao}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card hover-elevate" data-testid={`link-plan-crewup-${s.icao}`}>
                    <Users className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>

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

      <Link href="/today" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover-elevate" data-testid="link-plan-today">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15"><PlaneLanding className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">At the field now?</span>
          <span className="block text-xs text-muted-foreground">Layover today: weather, sunset, crew picks and crew there</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

    </div>
  );
}
