import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, MapPin, Clock, Search, Plus, X, ChevronRight, Lightbulb, ShieldCheck, List, Sparkles, Trophy, LocateFixed, Loader2, Utensils } from "lucide-react";
import type { Highlights } from "@shared/highlights";
import { TIME_BUCKETS, type Category, type SpotWithStats, type Airport } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { CAT_META, fmtMinutes, totalMinutes, parseTags, Stars, AdBanner, Chip, VetBadge, GoAroundBadge } from "@/lib/ui";
import { FavoriteButton } from "@/lib/favorites";
import { COST_LABELS, PACES, costOptions, costText, paceLabel, paceOf, type PaceId } from "@shared/cost";
import { getPosition, type NearAirport } from "@/lib/geo";
import { useToast } from "@/hooks/use-toast";
import { trustScore } from "@shared/vetting";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SearchState = {
  category: Category | null;
  route: string;
  time: string | null;
  pace: PaceId | null;
  cost: number | null;
  sort: "trusted" | "rating" | "close" | "new";
  vettedOnly: boolean;
  /** true = user chose to scroll through everything instead of searching a route */
  browse: boolean;
};
const SearchCtx = createContext<[SearchState, (p: Partial<SearchState>) => void]>([
  { category: null, route: "", time: null, pace: null, cost: null, sort: "trusted", vettedOnly: false, browse: false },
  () => {},
]);
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [s, set] = useState<SearchState>({ category: null, route: "", time: null, pace: null, cost: null, sort: "trusted", vettedOnly: false, browse: false });
  return <SearchCtx.Provider value={[s, (p) => set((o) => ({ ...o, ...p }))]}>{children}</SearchCtx.Provider>;
}
export const useSearch = () => useContext(SearchCtx);

type SearchResp = { legs: { code: string; airport: Airport | null }[]; spots: SpotWithStats[] };

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Home() {
  const [s, set] = useSearch();
  const routeRef = useRef<HTMLInputElement>(null);

  if (!s.category) return <Prompt onPick={(c) => { set({ category: c }); setTimeout(() => routeRef.current?.focus(), 50); }} />;
  return <Results routeRef={routeRef} />;
}

function Prompt({ onPick }: { onPick: (c: Category) => void }) {
  const [, set] = useSearch();
  const { data: hl } = useQuery<Highlights>({ queryKey: ["/api/highlights"] });
  const count = hl?.totals.spots ?? 0;
  const fields = hl?.totals.fields ?? 0;
  return (
    <div className="space-y-6">
      <section className="pt-2">
        <p className="font-code text-xs text-primary tracking-[0.2em] uppercase">Crew-sourced layover intel</p>
        <h1 className="mt-3 text-xl font-semibold leading-tight sm:text-[1.75rem] sm:leading-[1.15]">
          Wheels down.
          <br />
          <span className="text-muted-foreground">What are you looking for?</span>
        </h1>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(CAT_META) as Category[]).map((c) => {
          const M = CAT_META[c];
          return (
            <button
              key={c}
              onClick={() => onPick(c)}
              data-testid={`button-category-${c}`}
              className="group rounded-2xl border border-card-border bg-card p-4 text-left hover-elevate active-elevate-2 min-h-[120px] flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
                  <M.icon className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div>
                <p className="text-base font-semibold">{M.label}</p>
                <p className="text-xs text-muted-foreground">{M.prompt}</p>
              </div>
            </button>
          );
        })}
      </div>

      <AdBanner slot="top" />

      <div className="flex items-center justify-between rounded-2xl border border-card-border bg-card px-4 py-3">
        <div className="flex gap-6">
          <div>
            <p className="font-code text-lg font-bold tabular" data-testid="text-count-spots">{count}</p>
            <p className="text-xs text-muted-foreground">crew picks</p>
          </div>
          <div>
            <p className="font-code text-lg font-bold tabular" data-testid="text-count-fields">{fields}</p>
            <p className="text-xs text-muted-foreground">airfields</p>
          </div>
        </div>
        <Link href="/add" data-testid="link-add-home" className="inline-flex items-center gap-1.5 rounded-full taxi-sign px-4 py-2 text-sm font-semibold hover-elevate">
          <Plus className="h-4 w-4" /> Add a spot
        </Link>
      </div>

      <div className="rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground flex gap-3">
        <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <p>Search a whole trip at once: type your route like <span className="font-code text-foreground">MIA TEB ASE</span> or <span className="font-code text-foreground">KOPF-KPBI</span>. IATA and ICAO both work.</p>
      </div>

      <Rail title="Top rated by crews" icon={Trophy} spots={hl?.top.slice(0, 5)} testId="rail-top" />
      <Rail title="Just added" icon={Sparkles} spots={hl?.newest.slice(0, 5)} testId="rail-new" />

      <BrowseButton count={count} onClick={() => set({ category: "eat", browse: true, route: "" })} testId="button-browse-all-home" sub={`Scroll all ${count} picks by category, 10 at a time`} />
    </div>
  );
}

function BrowseButton({ onClick, testId, sub, title = "Browse everything" }: { count?: number; onClick: () => void; testId: string; sub: string; title?: string }) {
  return (
    <button onClick={onClick} data-testid={testId}
      className="w-full flex items-center justify-between rounded-2xl border border-card-border bg-card px-4 py-3.5 hover-elevate">
      <span className="flex items-center gap-3"><List className="h-4 w-4 text-primary shrink-0" />
        <span className="text-left"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{sub}</span></span>
      </span>
      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}

/** Horizontal strip of compact cards, used for highlights instead of dumping the whole catalog. */
function Rail({ title, icon: Icon, spots, testId }: { title: string; icon: any; spots?: SpotWithStats[]; testId: string }) {
  if (spots && spots.length === 0) return null;
  return (
    <section className="space-y-2" data-testid={testId}>
      <h2 className="text-sm font-semibold flex items-center gap-1.5"><Icon className="h-4 w-4 text-primary" />{title}</h2>
      <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 snap-x pb-1">
        {!spots && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[132px] w-[220px] shrink-0 rounded-2xl" />)}
        {spots?.map((sp) => {
          const M = CAT_META[sp.category as Category];
          return (
            <Link key={sp.id} href={`/spot/${sp.id}`} data-testid={`${testId}-card-${sp.id}`}
              className="snap-start shrink-0 w-[220px] rounded-2xl border border-card-border bg-card p-3.5 hover-elevate flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-code text-[11px] font-bold taxi-sign rounded px-1.5 py-0.5">{sp.icao}</span>
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><M.icon className="h-3 w-3" />{M.label}</span>
              </div>
              <p className="text-sm font-semibold leading-snug line-clamp-2">{sp.name}</p>
              <div className="mt-auto flex flex-col items-start gap-1.5">
                {sp.reviewCount ? <span className="text-xs inline-flex items-center gap-1"><Stars value={sp.avgRating ?? 0} size={12} /><span className="text-muted-foreground tabular">{sp.avgRating?.toFixed(1)} · {sp.reviewCount} {sp.reviewCount === 1 ? "rating" : "ratings"}</span></span> : <span className="text-xs text-muted-foreground whitespace-nowrap">No ratings yet</span>}
                <VetBadge vet={sp.vet} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Results({ routeRef }: { routeRef: React.RefObject<HTMLInputElement> }) {
  const [s, set] = useSearch();
  const cat = s.category!;
  const route = useDebounced(s.route.trim());
  const { data, isLoading } = useQuery<SearchResp>({
    queryKey: ["/api/search", route],
    queryFn: async () => (await apiRequest("GET", `/api/search?route=${encodeURIComponent(route)}`)).json(),
  });

  const showTime = cat === "do";
  const showPace = cat === "eat";
  const showCost = cat !== "fbo";
  const bucket = TIME_BUCKETS.find((b) => b.id === s.time);
  const budget = s.cost != null && costOptions(cat).includes(s.cost) ? s.cost : null;
  const { toast } = useToast();
  const [locating, setLocating] = useState(false);
  async function nearMe() {
    setLocating(true);
    try {
      const pos = await getPosition();
      const near = (await (await apiRequest("GET", `/api/airports/nearest?lat=${pos.lat}&lon=${pos.lng}`)).json()) as NearAirport[];
      if (near[0]) { set({ route: near[0].icao }); toast({ title: `Nearest field: ${near[0].icao}`, description: `${near[0].name} · ${near[0].miles} mi away` }); }
      else toast({ title: "No airport found nearby", description: "Type the code instead." });
    } catch (e) {
      toast({ title: "Location unavailable", description: String((e as Error).message || e).replace(/^\d+: /, ""), variant: "destructive" });
    } finally { setLocating(false); }
  }

  const filtered = useMemo(() => {
    let list = (data?.spots || []).filter((x) => x.category === cat);
    if (showTime && bucket) list = list.filter((x) => totalMinutes(x) <= bucket.max);
    if (showPace && s.pace) list = list.filter((x) => paceOf(x) === s.pace);
    if (showCost && budget != null) list = list.filter((x) => x.cost != null && x.cost <= budget);
    if (s.vettedOnly) list = list.filter((x) => x.vet.level === "vetted");
    const sorters = {
      trusted: (a: SpotWithStats, b: SpotWithStats) => trustScore(b.vet) - trustScore(a.vet) || (b.avgRating ?? 0) - (a.avgRating ?? 0),
      rating: (a: SpotWithStats, b: SpotWithStats) => (b.avgRating ?? 0) - (a.avgRating ?? 0) || b.reviewCount - a.reviewCount,
      close: (a: SpotWithStats, b: SpotWithStats) => (a.milesFromField ?? 0) - (b.milesFromField ?? 0),
      new: (a: SpotWithStats, b: SpotWithStats) => b.createdAt - a.createdAt,
    };
    return [...list].sort(sorters[s.sort]);
  }, [data, cat, s.time, s.pace, budget, s.sort, s.vettedOnly, showTime, showPace, showCost]);

  const legs = data?.legs || [];
  const icaos = legs.filter((l) => l.airport).map((l) => l.airport!.icao);
  // Group by airport in route order
  const groups = useMemo(() => {
    if (!route) return [{ icao: "", label: "All picks", spots: filtered }];
    return icaos
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((icao) => {
        const ap = legs.find((l) => l.airport?.icao === icao)!.airport!;
        return { icao, label: `${ap.city}${ap.region ? ", " + ap.region : ""}`, airport: ap, spots: filtered.filter((x) => x.icao === icao) };
      });
  }, [filtered, route, data]);

  const M = CAT_META[cat];
  let cardIndex = 0;
  const PAGE = 10, PER_AIRPORT = 6;
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => { setShown(PAGE); setExpanded(new Set()); }, [cat, route, s.time, s.pace, s.cost, s.vettedOnly, s.sort, s.browse]);
  const mode: "choose" | "browse" | "route" = route ? "route" : s.browse ? "browse" : "choose";
  const { data: hl } = useQuery<Highlights>({ queryKey: [`/api/highlights?category=${cat}`], enabled: mode === "choose" });

  return (
    <div className="space-y-5">
      {/* Category switcher */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {(Object.keys(CAT_META) as Category[]).map((c) => {
          const I = CAT_META[c].icon;
          return (
            <Chip key={c} active={c === cat} onClick={() => set({ category: c })} testId={`chip-category-${c}`}>
              <span className="inline-flex items-center gap-1.5"><I className="h-3.5 w-3.5" />{CAT_META[c].label}</span>
            </Chip>
          );
        })}
      </div>

      {/* Route input */}
      <div>
        <label htmlFor="route" className="text-xs font-medium text-muted-foreground">Where are you headed? Enter your route</label>
        <div className="mt-1.5 flex items-center h-12 rounded-xl border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
          <Search className="ml-3.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            id="route"
            ref={routeRef}
            value={s.route}
            onChange={(e) => set({ route: e.target.value.toUpperCase() })}
            placeholder="MIA TEB  or  KOPF-KASE"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            data-testid="input-route"
            className="min-w-0 flex-1 h-full bg-transparent px-3 font-code text-base tracking-wider placeholder:text-muted-foreground/60 placeholder:tracking-normal focus:outline-none"
          />
          {s.route ? (
            <button onClick={() => set({ route: "" })} aria-label="Clear route" data-testid="button-clear-route" className="mr-2 h-8 w-8 shrink-0 grid place-items-center rounded-full hover-elevate text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={nearMe} disabled={locating} aria-label="Use my location" data-testid="button-near-me"
              className="mr-1.5 h-9 shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-primary hover-elevate disabled:opacity-60">
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}<span className="hidden min-[380px]:inline">Near me</span>
            </button>
          )}
        </div>
        {legs.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="route-legs">
            {legs.map((l, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <span
                  className={cn(
                    "font-code text-xs font-bold rounded-md px-1.5 py-0.5",
                    l.airport ? "taxi-sign" : "bg-destructive/15 text-destructive line-through",
                  )}
                  title={l.airport ? l.airport.name : "Unknown airport"}
                  data-testid={`leg-${l.code}`}
                >
                  {l.airport ? l.airport.icao : l.code}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {mode === "choose" ? (
        <div className="space-y-5" data-testid="section-choose">
          <Rail title={`Top rated ${M.label.toLowerCase()}`} icon={Trophy} spots={hl?.top.slice(0, 4)} testId="rail-cat-top" />
          <Rail title="Just added" icon={Sparkles} spots={hl?.newest.slice(0, 4)} testId="rail-cat-new" />
          <BrowseButton onClick={() => set({ browse: true })} testId="button-browse-all" title={`Browse all ${M.label.toLowerCase()} picks`} sub="No route in mind? Scroll everything, with filters" />
          <AdBanner slot="footer" icaos={[]} />
        </div>
      ) : (<>
      {mode === "browse" && (
        <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3.5 py-2.5 text-sm" data-testid="banner-browsing">
          <span className="flex items-center gap-2"><List className="h-4 w-4 text-primary" />Browsing all {M.label.toLowerCase()} picks</span>
          <button onClick={() => set({ browse: false })} className="text-xs font-medium text-primary" data-testid="button-exit-browse">Back to highlights</button>
        </div>
      )}
      {/* Filters */}
      {showTime && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />How much time do you have?</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            <Chip active={!s.time} onClick={() => set({ time: null })} testId="chip-time-any">Any</Chip>
            {TIME_BUCKETS.map((b) => (
              <Chip key={b.id} active={s.time === b.id} onClick={() => set({ time: b.id })} testId={`chip-time-${b.id}`}>
                {b.label} <span className={cn("ml-1 text-xs", s.time === b.id ? "opacity-80" : "text-muted-foreground")}>{b.sub}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}
      {showPace && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5"><Utensils className="h-3.5 w-3.5" />Grab & go or sit down?</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            <Chip active={!s.pace} onClick={() => set({ pace: null })} testId="chip-pace-any">Either</Chip>
            {PACES.map((p) => <Chip key={p.id} active={s.pace === p.id} onClick={() => set({ pace: p.id })} testId={`chip-pace-${p.id}`}>{p.label}</Chip>)}
          </div>
        </div>
      )}
      {showCost && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Budget (up to) · crew-reported prices</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            <Chip active={budget == null} onClick={() => set({ cost: null })} testId="chip-cost-any">Any</Chip>
            {costOptions(cat).map((i) => (
              <Chip key={i} active={budget === i} onClick={() => set({ cost: i })} testId={`chip-cost-${i}`} className="font-code">{COST_LABELS[i]}</Chip>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => set({ vettedOnly: !s.vettedOnly })}
        aria-pressed={s.vettedOnly}
        data-testid="toggle-vetted"
        className={cn("w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left hover-elevate",
          s.vettedOnly ? "border-emerald-500/60 bg-emerald-500/10" : "border-border bg-card")}
      >
        <span className="flex items-center gap-2.5">
          <ShieldCheck className={cn("h-4 w-4", s.vettedOnly ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
          <span>
            <span className="block text-sm font-semibold">Crew-vetted only</span>
            <span className="block text-xs text-muted-foreground">3+ upvotes in the last year, 75%+ positive</span>
          </span>
        </span>
        <span className={cn("h-5 w-9 rounded-full p-0.5 transition-colors", s.vettedOnly ? "bg-emerald-500" : "bg-muted")}>
          <span className={cn("block h-4 w-4 rounded-full bg-white shadow transition-transform", s.vettedOnly && "translate-x-4")} />
        </span>
      </button>

      <AdBanner slot="top" icaos={icaos} />

      <div className="flex items-center justify-between pt-1">
        <p className="text-sm text-muted-foreground" data-testid="text-result-count">
          <span className="font-semibold text-foreground tabular">{filtered.length}</span> {M.label.toLowerCase()} {filtered.length === 1 ? "pick" : "picks"}
          {bucket && <> within {bucket.sub}</>}
        </p>
        <select
          value={s.sort}
          onChange={(e) => set({ sort: e.target.value as SearchState["sort"] })}
          data-testid="select-sort"
          className="h-8 rounded-lg border border-input bg-card px-2 text-xs"
          aria-label="Sort results"
        >
          <option value="trusted">Most trusted</option>
          <option value="rating">Top rated</option>
          <option value="close">Closest to field</option>
          <option value="new">Newest</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : route && icaos.length === 0 ? (
        <Empty title="No airports matched" body="Try a 3-letter IATA (MIA) or 4-letter ICAO (KMIA) code. Unknown fields can be added when you submit a spot." />
      ) : (
        groups.map((g) => (
          <section key={g.icao || "all"} className="space-y-3">
            {route && (
              <div className="flex items-baseline gap-2 pt-2">
                <span className="font-code text-sm font-bold text-primary">{g.icao}</span>
                <h2 className="text-base font-semibold">{g.label}</h2>
                <span className="text-xs text-muted-foreground truncate">{(g as any).airport?.name}</span>
              </div>
            )}
            {g.spots.length === 0 ? (
              <Empty
                title={`No ${M.label.toLowerCase()} picks${s.time || s.pace || budget != null || s.vettedOnly ? " match these filters" : " yet"}`}
                body="Be the first crew to drop one here."
                icao={g.icao}
              />
            ) : (
              <>
                {g.spots.slice(0, mode === "browse" ? shown : expanded.has(g.icao) ? g.spots.length : PER_AIRPORT).map((spot) => {
                  const i = cardIndex++;
                  return (
                    <div key={spot.id} className="space-y-3">
                      <SpotCard spot={spot} />
                      {i % 4 === 3 && <AdBanner slot="inline" icaos={icaos} index={Math.floor(i / 4)} />}
                    </div>
                  );
                })}
                {mode === "browse" && g.spots.length > shown && (
                  <button onClick={() => setShown(shown + PAGE)} data-testid="button-show-more"
                    className="w-full h-11 rounded-full border border-border bg-card text-sm font-semibold hover-elevate">
                    Show {Math.min(PAGE, g.spots.length - shown)} more <span className="text-muted-foreground font-normal">· {g.spots.length - shown} left</span>
                  </button>
                )}
                {mode === "route" && !expanded.has(g.icao) && g.spots.length > PER_AIRPORT && (
                  <button onClick={() => setExpanded(new Set(Array.from(expanded).concat(g.icao)))} data-testid={`button-show-all-${g.icao}`}
                    className="w-full h-11 rounded-full border border-border bg-card text-sm font-semibold hover-elevate">
                    Show all {g.spots.length} at {g.icao}
                  </button>
                )}
              </>
            )}
          </section>
        ))
      )}

      <AdBanner slot="footer" icaos={icaos} className="mt-6" />
      </>)}
    </div>
  );
}

function Empty({ title, body, icao }: { title: string; body: string; icao?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-5 py-6 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{body}</p>
      <Link href={icao ? `/add/${icao}` : "/add"} data-testid={`link-add-empty-${icao || "any"}`} className="mt-3 inline-flex items-center gap-1.5 rounded-full taxi-sign px-3.5 py-1.5 text-xs font-semibold hover-elevate">
        <Plus className="h-3.5 w-3.5" /> Add a spot{icao ? ` at ${icao}` : ""}
      </Link>
    </div>
  );
}

export function SpotCard({ spot }: { spot: SpotWithStats }) {
  const tags = parseTags(spot.tags).slice(0, 3);
  const M = CAT_META[spot.category as Category];
  return (
    <Link href={`/spot/${spot.id}`} data-testid={`card-spot-${spot.id}`} className="block rounded-2xl border border-card-border bg-card p-4 hover-elevate active-elevate-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 rounded-full", M.dot)} />
            <span className="font-code font-bold text-foreground">{spot.icao}</span>
            {spot.milesFromField != null && (
              <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{spot.milesFromField === 0 ? "On field" : `${spot.milesFromField} mi`}</span>
            )}
          </div>
          <h3 className="mt-1 text-base font-semibold leading-snug">{spot.name}</h3>
        </div>
        <div className="shrink-0 flex items-start gap-2">
          {spot.category !== "fbo" && (
            <span className="text-right pt-1" data-testid={`text-cost-${spot.id}`}>
              <span className={cn("font-code text-sm font-bold", spot.cost == null ? "text-muted-foreground" : "text-primary")}>{costText(spot)}</span>
              {spot.costVotes > 1 && <span className="block text-[10px] text-muted-foreground leading-tight">{spot.costVotes} crew</span>}
            </span>
          )}
          <FavoriteButton spotId={spot.id} name={spot.name} size="sm" />
        </div>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">{spot.description}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2"><VetBadge vet={spot.vet} />{spot.goArounds > 0 && <GoAroundBadge count={spot.goArounds} />}</div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {spot.reviewCount > 0 ? (
            <>
              <Stars value={spot.avgRating ?? 0} size={13} />
              <span className="text-xs text-muted-foreground tabular">{spot.avgRating?.toFixed(1)} · {spot.reviewCount}</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No ratings yet</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {spot.category === "do" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5"><Clock className="h-3 w-3" />{fmtMinutes(totalMinutes(spot))}</span>
          )}
          {spot.category === "eat" && <span className="rounded-md bg-muted px-1.5 py-0.5" data-testid={`text-pace-${spot.id}`}>{paceLabel(paceOf(spot))}</span>}
          {tags.slice(0, spot.category === "fbo" ? 2 : 1).map((t) => (
            <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 hidden xs:inline sm:inline">{t}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
