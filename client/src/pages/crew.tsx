import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, Search, X, PlaneLanding } from "lucide-react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { TIERS, type PublicUser } from "@shared/tiers";
import { useAuth, Insignia, TierChip } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TierLadder } from "./profile";

type Row = PublicUser & { rank: number };
type Board = { total: number; crewTotal: number; base: string | null; rows: Row[]; offset: number; limit: number };
const PAGE = 50;

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function CrewPage() {
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [base, setBase] = useState("");
  const [shown, setShown] = useState(PAGE);
  const dq = useDebounced(q.trim()), dbase = useDebounced(base.trim().toUpperCase());
  useEffect(() => setShown(PAGE), [dq, dbase]);

  const params = new URLSearchParams({ offset: "0", limit: String(shown) });
  if (dq) params.set("q", dq);
  if (dbase.length >= 3) params.set("base", dbase);
  const { data: first, isLoading, isFetching } = useQuery<Board>({ queryKey: [`/api/leaderboard?${params}`], placeholderData: keepPreviousData, staleTime: 30_000 });
  const rows = first?.rows || [];
  const { data: top } = useQuery<Board>({ queryKey: ["/api/leaderboard?offset=0&limit=50"], staleTime: 30_000 });
  const albatrosses = (top?.rows || []).filter((u) => u.tierId === "ancient_albatross");
  const { data: mine } = useQuery<{ rank: number; user: PublicUser }>({ queryKey: [`/api/crew/${me?.id}`], enabled: !!me, staleTime: 30_000 });
  const { data: bases } = useQuery<{ code: string; n: number }[]>({ queryKey: ["/api/leaderboard/bases"] });
  const baseHints = base.trim().length >= 1 ? (bases || []).filter((b) => b.code.startsWith(base.trim().toUpperCase()) && b.code !== base.trim().toUpperCase()).slice(0, 5) : [];
  const filtered = !!dq || dbase.length >= 3;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Crew leaderboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Everyone keeping the network vetted, ranked by points. Search for a person or a home base.</p>
      </header>

      {albatrosses.length > 0 && (
        <section className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(135deg,#0B0F1A,#1F2937 60%,#F8D27A44)" }} data-testid="section-albatross-wall">
          <p className="font-code text-[10px] tracking-[0.25em] text-[#F8D27A]">THE ALBATROSS WALL</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {albatrosses.map((u) => (
              <Link key={u.id} href={`/crew/${u.id}`} className="flex items-center gap-2">
                <Insignia tierId="ancient_albatross" className="h-6" />
                <div><p className="text-sm font-semibold">{u.displayName}</p><p className="text-[11px] text-white/60">{u.homeBase ? `${u.homeBase} · ` : ""}{u.points.toLocaleString()} pts</p></div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {me && mine && (
        <Link href={`/crew/${me.id}`} className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 hover-elevate" data-testid="card-my-rank">
          <span className="font-code text-lg font-bold tabular">#{mine.rank}</span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Your rank</p><p className="text-[11px] text-muted-foreground">of {first?.crewTotal ?? "–"} crew · {mine.user.points.toLocaleString()} pts</p></div>
          <TierChip tierId={mine.user.tierId} points={mine.user.points} />
        </Link>
      )}

      <div className="grid grid-cols-[1fr_7.5rem] gap-2" data-testid="panel-crew-search">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or @handle" aria-label="Search crew by name or handle" data-testid="input-crew-search"
            className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-8 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          {q && <button type="button" aria-label="Clear name search" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"><X className="h-4 w-4" /></button>}
        </label>
        <div className="relative">
          <PlaneLanding className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={base} onChange={(e) => setBase(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))} placeholder="Base" aria-label="Home base airport code" data-testid="input-crew-base"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-7 font-code text-base sm:text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ring" />
          {base && <button type="button" aria-label="Clear base" onClick={() => setBase("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"><X className="h-4 w-4" /></button>}
          {baseHints.length > 0 && (
            <ul className="absolute right-0 z-20 mt-1 w-full rounded-xl border border-border bg-popover py-1 shadow-lg" data-testid="list-base-hints">
              {baseHints.map((b) => (
                <li key={b.code}><button type="button" onClick={() => setBase(b.code)} className="flex w-full justify-between px-3 py-1.5 text-xs hover-elevate"><span className="font-code font-bold">{b.code}</span><span className="text-muted-foreground">{b.n}</span></button></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="-mt-3 text-[11px] text-muted-foreground" data-testid="text-crew-count">
        {first ? (filtered ? `${first.total} of ${first.crewTotal} crew match${first.base ? ` · base ${first.base}` : ""}` : `${first.crewTotal} crew ranked`) : "\u00a0"}
        {base.trim().length > 0 && base.trim().length < 3 ? " · type 3 or 4 characters for a base" : ""}
      </p>

      <ol className={cn("rounded-2xl border border-card-border bg-card divide-y divide-border", isFetching && "opacity-80")} data-testid="list-leaderboard">
        {isLoading && <li className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></li>}
        {!isLoading && rows.length === 0 && <li className="p-4 text-sm text-muted-foreground" data-testid="text-crew-empty">No crew match that search.</li>}
        {rows.map((u) => (
          <li key={u.id} className={cn(me?.id === u.id && "bg-primary/10")} data-testid={`row-crew-${u.handle || u.id}`}>
            <Link href={`/crew/${u.id}`} className="flex items-center gap-3 px-4 py-3 hover-elevate" data-testid={`link-crew-${u.id}`}>
              <span className={cn("min-w-[2rem] font-code text-sm font-bold tabular", u.rank <= 3 ? "text-primary" : "text-muted-foreground")}>{u.rank}</span>
              <Insignia tierId={u.tierId} className="h-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{u.displayName}{me?.id === u.id && <span className="ml-1.5 text-[10px] uppercase text-primary">You</span>}</p>
                <p className="text-[11px] text-muted-foreground truncate">{u.handle ? `@${u.handle} · ` : ""}{u.crewRole}{u.homeBase ? ` · ${u.homeBase}` : ""}</p>
                <div className="mt-1"><TierChip tierId={u.tierId} points={u.points} /></div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-code text-sm font-bold tabular">{u.points.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">pts</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </Link>
          </li>
        ))}
      </ol>
      {first && rows.length < first.total && (
        <button type="button" onClick={() => setShown(shown + PAGE)} disabled={isFetching} data-testid="button-crew-more"
          className="w-full h-11 rounded-full border border-border text-sm font-medium hover-elevate disabled:opacity-60">
          {isFetching ? "Loading…" : `Show more · ${first.total - rows.length} left`}
        </button>
      )}

      <TierLadder points={me?.points ?? 0} signedIn={!!me} />
      <p className="text-[11px] text-muted-foreground">{TIERS.length} ratings. Points are counted from your activity, so the total always matches your logbook. Equal points share a rank.</p>
    </div>
  );
}
