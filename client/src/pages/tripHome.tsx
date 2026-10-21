// Home (four-tab layout): the trip hub. Your next layover from your briefs, and where you are in the crew workflow:
// Plan → Find spots → Add spots → Rate after the trip. With no brief yet, one big button: plan your next layover.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { BookUser, CalendarPlus, Check, ChevronRight, ClipboardList, Loader2, MapPin, PlaneLanding, PlusCircle, Search, Star, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTripState } from "@/lib/experience";
import { crewUpHref, fmtArrive, type TripResp, type TripStop } from "@/lib/tripNav";
import { cn } from "@/lib/utils";

const LAYOVER: Record<string, string> = { quick: "Quick turn", hours: "A few hours", overnight: "Overnight", multi: "Multi-day" };

export default function TripHomePage() {
  const { me } = useAuth();
  const { on, ready, adminOnly } = useTripState();
  const [, go] = useLocation();
  useEffect(() => { if (ready && !on) go("/", { replace: true }); }, [ready, on]); // eslint-disable-line
  const { data, isLoading } = useQuery<TripResp>({ queryKey: ["/api/preview/trip"], enabled: on, staleTime: 30_000, retry: false });
  if (!on) return null;
  const first = (me?.displayName || "").split(" ")[0];

  return (
    <div className="space-y-5" data-testid="page-trip-home">
      <header>
        {adminOnly && <span className="mb-2 inline-flex items-center rounded-full border border-dashed border-primary/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary" data-testid="badge-trip-preview">Preview · admins only</span>}
        <p className="font-code text-xs font-semibold uppercase tracking-[0.2em] text-primary">Wheels down{first ? `, ${first}` : ""}</p>
        <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight tracking-tight">{data?.next ? "Your next layover" : "Plan your next layover"}</h1>
      </header>

      {isLoading ? <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : data?.next ? <TripCard s={data.next} /> : <NoTrip />}

      {data?.rate && data.rate !== data.next && (
        <Link href="/rate" className="flex items-center gap-3 rounded-2xl border border-primary/50 bg-primary/5 p-4 hover-elevate" data-testid="card-trip-rate">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15"><Star className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">How was <span className="font-code">{data.rate.icao}</span>?</span>
            <span className="block text-xs text-muted-foreground">Rate {data.rate.steps.toRate.length} place{data.rate.steps.toRate.length === 1 ? "" : "s"} from that trip. Your ratings help the next crew.</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      )}

      {data && data.later.length > 0 && (
        <section className="space-y-2" data-testid="section-trip-later">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coming up</h2>
          <ul className="space-y-2">
            {data.later.map((s) => (
              <li key={`${s.briefId}-${s.stopIndex}`}>
                <Link href={`/brief/${s.briefId}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 hover-elevate" data-testid={`link-trip-later-${s.icao}`}>
                  <span className="font-code text-sm font-bold">{s.icao}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{fmtArrive(s)} · {s.place}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/today" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover-elevate" data-testid="link-trip-today">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15"><PlaneLanding className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">At the field now?</span>
          <span className="block text-xs text-muted-foreground">Today: weather, sunset, your picks and crew there</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <section className="grid grid-cols-2 gap-2.5" data-testid="grid-trip-quick">
        <Quick href="/" icon={Search} title="Find spots" body="Crew-rated places" />
        <Quick href="/meetup" icon={Users} title="Crew Up" body="Plans with your crew" />
        <Quick href="/brief" icon={ClipboardList} title="Your briefs" body={data ? `${data.briefCount} saved` : "Saved trips"} />
        <Quick href="/me" icon={BookUser} title="Logbook" body="Points and settings" />
      </section>
    </div>
  );
}

function Quick({ href, icon: Icon, title, body }: { href: string; icon: typeof Search; title: string; body: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-2xl border border-card-border bg-card p-3 hover-elevate" data-testid={`link-trip-quick-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15"><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold leading-tight">{title}</span><span className="block truncate text-[11px] text-muted-foreground">{body}</span></span>
    </Link>
  );
}

function NoTrip() {
  return (
    <section className="rounded-2xl border border-primary/50 bg-card p-4" data-testid="card-trip-none">
      <p className="text-sm text-muted-foreground">Where are you headed? Make a brief for the trip and Wheelsdown walks you through it.</p>
      <Steps />
      <Link href="/brief/new" className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full taxi-sign text-base font-semibold hover-elevate" data-testid="button-trip-plan">
        <CalendarPlus className="h-5 w-5" />Plan your next layover
      </Link>
    </section>
  );
}

/** The workflow, for someone who hasn't started a brief yet. */
function Steps() {
  const items = ["Plan: the airport and when you land", "Find spots: crew-rated food, things to do, a hotel", "Add spots crews should know about", "Rate the places after your trip"];
  return (
    <ol className="mt-3 space-y-2">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border font-code text-xs font-bold">{i + 1}</span>
          <span className="pt-0.5">{t}</span>
        </li>
      ))}
    </ol>
  );
}

type Step = { key: string; title: string; detail: string; done: boolean; current: boolean; href?: string; cta?: string };
function TripCard({ s }: { s: TripStop }) {
  const after = s.when === "past" || s.when === "now";
  const found = s.steps.picks > 0 || s.steps.aiOn;
  const rateLeft = s.steps.toRate.length;
  const raw: Omit<Step, "current">[] = [
    { key: "plan", title: "Plan", done: !!s.arriveDate, detail: s.arriveDate ? `Brief saved, landing ${fmtArrive(s)}` : "Brief saved. Add when you land so crew can plan with you.", href: `/brief/${s.briefId}`, cta: s.arriveDate ? undefined : "Add date" },
    { key: "find", title: "Find spots", done: found, detail: found ? `${s.steps.picks || "AI"} place${s.steps.picks === 1 ? "" : "s"} in your brief` : "Pick where to eat, what to do and where to stay", href: `/brief/${s.briefId}`, cta: found ? "Open" : "Pick places" },
    { key: "add", title: "Add spots", done: s.steps.added, detail: s.steps.added ? `You've added places at ${s.icao}` : "Know a place crews should know? Add it", href: `/add/${s.icao}`, cta: "Add" },
    { key: "rate", title: "Rate after the trip", done: after && s.steps.picks > 0 && rateLeft === 0,
      detail: !after ? "After your trip, rate the places you went" : rateLeft ? `${rateLeft} place${rateLeft === 1 ? "" : "s"} waiting for your rating` : "Rate the places you went", href: after ? "/rate" : undefined, cta: after ? "Rate" : undefined },
  ];
  const cur = raw.findIndex((x) => !x.done && (x.key !== "rate" || after));
  const steps: Step[] = raw.map((x, i) => ({ ...x, current: i === cur }));

  return (
    <section className="overflow-hidden rounded-2xl border border-card-border bg-card" data-testid="card-trip-next">
      <Link href={`/brief/${s.briefId}`} className="block border-b border-border p-4 hover-elevate" data-testid="link-trip-brief">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-code text-3xl font-bold leading-none tracking-tight" data-testid="text-trip-icao">{s.icao}</p>
            <p className="mt-1 truncate text-sm text-muted-foreground"><MapPin className="mr-1 inline h-3.5 w-3.5" />{s.place}</p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", s.when === "now" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground")}>
            {s.when === "now" ? "On this trip" : s.when === "undated" ? "No date yet" : LAYOVER[s.layover] || s.layover}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium" data-testid="text-trip-when">{s.arriveDate ? fmtArrive(s) : "Add your arrival date to the brief"}</p>
        {s.title && <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.title}</p>}
      </Link>

      <ol className="divide-y divide-border" data-testid="list-trip-steps">
        {steps.map((st, i) => (
          <li key={st.key} className={cn("flex items-center gap-3 px-4 py-3", st.current && "bg-primary/5")} data-testid={`step-trip-${st.key}`} data-done={st.done ? "1" : "0"}>
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full font-code text-xs font-bold",
              st.done ? "bg-primary text-primary-foreground" : st.current ? "border-2 border-primary text-foreground" : "border border-border text-muted-foreground")}>
              {st.done ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-semibold", !st.done && !st.current && "text-muted-foreground")}>{st.title}</span>
              <span className="block text-xs leading-snug text-muted-foreground">{st.detail}</span>
            </span>
            {st.href && st.cta && (
              <Link href={st.href} className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold hover-elevate", st.current ? "taxi-sign" : "border border-border")} data-testid={`button-trip-${st.key}`}>{st.cta}</Link>
            )}
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
        <Link href={`/brief/${s.briefId}`} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold hover-elevate" data-testid="button-trip-open"><ClipboardList className="h-4 w-4" />Open brief</Link>
        <Link href={crewUpHref(s)} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold hover-elevate" data-testid="button-trip-crewup"><Users className="h-4 w-4" />Crew Up here</Link>
      </div>
      <Link href="/brief/new" className="flex items-center justify-center gap-1.5 border-t border-border py-2.5 text-xs font-medium text-muted-foreground hover-elevate" data-testid="link-trip-new"><PlusCircle className="h-3.5 w-3.5" />Plan another layover</Link>
    </section>
  );
}
