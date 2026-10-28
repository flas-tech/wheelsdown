/**
 * Crews' Choice (PJ's feedback #68): each month every member gets one vote per field for the best place to eat there.
 * The month's leader is that field's Crews' Choice; votes add up to the Crews' Choice of the year. Votes are private,
 * only counts show. Admins first: crews_choice_audience (useCrewsChoice) and the server both gate it.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Trophy, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCrewsChoice } from "@/lib/experience";
import { cn } from "@/lib/utils";

type Leader = { spotId: number; name: string; votes: number };
type ChoiceResp = { icao: string; period: string; myVote: number | null; votes: number; month: Leader[]; lastMonth: (Leader & { period: string }) | null; year: { year: string; leaders: Leader[] } };

const monthName = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", timeZone: "UTC" }); };

function AdminsOnly() {
  return <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Admins only</span>;
}

/** Badge for a listing that won its field: "Crews' Choice · September" / "Crews' Choice 2026". */
export function CrewsChoiceBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-500/40 dark:text-amber-200", className)} data-testid="badge-crews-choice">
      <Trophy className="h-3 w-3" />{label}
    </span>
  );
}

/** On a place-to-eat listing: vote it this month's Crews' Choice for its field, and see the standings. */
export function CrewsChoiceVote({ spot }: { spot: { id: number; icao: string; category: string; name: string } }) {
  const gate = useCrewsChoice();
  const { toast } = useToast();
  const on = gate.on && spot.category === "eat";
  const key = ["/api/choice", spot.icao];
  const q = useQuery<ChoiceResp>({ queryKey: key, enabled: on, staleTime: 30_000, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/choice?icao=${encodeURIComponent(spot.icao)}`)).json() });
  const done = () => { for (const k of [key, ["/api/choice/top"], ["/api/choice/badges", spot.icao]]) queryClient.invalidateQueries({ queryKey: k }); };
  const vote = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/choice", { spotId: spot.id })).json(),
    onSuccess: () => { done(); toast({ title: "Vote in", description: `${spot.name.trim()} is your Crews' Choice for ${spot.icao} this month. You can move it until the month ends.` }); },
    onError: (e: Error) => toast({ title: "Couldn't vote", description: e.message, variant: "destructive" }),
  });
  const undo = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/choice?icao=${encodeURIComponent(spot.icao)}`)).json(),
    onSuccess: () => { done(); toast({ title: "Vote removed" }); },
  });
  if (!on || !q.data) return null;
  const d = q.data;
  const mine = d.myVote === spot.id;
  const elsewhere = d.myVote != null && !mine ? d.month.find((l) => l.spotId === d.myVote)?.name || "another spot" : null;
  const here = d.month.find((l) => l.spotId === spot.id)?.votes || 0;
  const wonMonth = d.lastMonth?.spotId === spot.id;
  const wonYear = d.year.leaders[0]?.spotId === spot.id && d.year.leaders[0].votes >= 3;
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-50/60 p-4 dark:bg-amber-950/20" data-testid="card-crews-choice">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Trophy className="h-4 w-4 text-amber-600" />Crews' Choice · {spot.icao}</h2>
        {gate.adminOnly && <AdminsOnly />}
      </div>
      {(wonMonth || wonYear) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {wonMonth && <CrewsChoiceBadge label={`Crews' Choice · ${monthName(d.lastMonth!.period)}`} />}
          {wonYear && <CrewsChoiceBadge label={`Crews' Choice ${d.year.year}`} />}
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        One vote per crew member, per field, each month: the best place to eat near {spot.icao}. {here > 0 ? `${here} vote${here === 1 ? "" : "s"} here in ${monthName(d.period)}.` : `No votes here yet in ${monthName(d.period)}.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {mine ? (
          <>
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-white" data-testid="text-choice-voted"><Check className="h-4 w-4" />Your pick for {monthName(d.period)}</span>
            <button type="button" onClick={() => undo.mutate()} disabled={undo.isPending} className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline" data-testid="button-choice-undo">Remove vote</button>
          </>
        ) : (
          <button type="button" onClick={() => vote.mutate()} disabled={vote.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60" data-testid="button-choice-vote">
            <Trophy className="h-4 w-4" />{elsewhere ? "Move my vote here" : `Vote Crews' Choice for ${monthName(d.period)}`}
          </button>
        )}
        {elsewhere && <span className="text-[11px] text-muted-foreground">Your vote is on {elsewhere}.</span>}
      </div>
      {d.month.length > 0 && (
        <ol className="mt-3 space-y-1 text-xs" data-testid="list-choice-standings">
          {d.month.slice(0, 3).map((l, i) => (
            <li key={l.spotId} className="flex items-center gap-2">
              <span className="w-4 font-code text-muted-foreground">{i + 1}</span>
              {l.spotId === spot.id ? <span className="flex-1 truncate font-semibold">{l.name}</span> : <Link href={`/spot/${l.spotId}`} className="flex-1 truncate hover:underline">{l.name}</Link>}
              <span className="font-code tabular text-muted-foreground">{l.votes}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Crew page: this month's leader at each field with votes. */
export function CrewsChoiceCard() {
  const gate = useCrewsChoice();
  const q = useQuery<{ period: string; fields: { icao: string; spotId: number; name: string; votes: number; total: number }[] }>({
    queryKey: ["/api/choice/top"], enabled: gate.on, staleTime: 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/choice/top")).json(),
  });
  if (!gate.on || !q.data) return null;
  const d = q.data;
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-card p-4" data-testid="card-crews-choice-top">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Trophy className="h-4 w-4 text-amber-600" />Crews' Choice · {monthName(d.period)}</h2>
        {gate.adminOnly && <AdminsOnly />}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">Crews vote once a month for the best place to eat at each field. Open any place to eat and tap Vote. The month's leader wins, and the votes add up to the Crews' Choice of the year.</p>
      {d.fields.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="text-choice-empty">No votes yet this month. Be the first: open a place to eat you love and vote for it.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {d.fields.map((f) => (
            <li key={f.icao} className="flex items-center gap-3 py-2 text-sm" data-testid={`row-choice-${f.icao}`}>
              <span className="w-12 shrink-0 font-code text-xs font-semibold text-muted-foreground">{f.icao}</span>
              <Link href={`/spot/${f.spotId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{f.name}</Link>
              <span className="shrink-0 font-code text-xs tabular text-muted-foreground">{f.votes}/{f.total}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
