import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, MapPin, Clock, Search, Plus, X, ChevronRight, Lightbulb } from "lucide-react";
import { TIME_BUCKETS, type Category, type SpotWithStats, type Airport } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { CAT_META, COST_LABELS, fmtMinutes, totalMinutes, parseTags, Stars, AdBanner, Chip } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SearchState = {
  category: Category | null;
  route: string;
  time: string | null;
  cost: number | null;
  sort: "rating" | "close" | "new";
};
const SearchCtx = createContext<[SearchState, (p: Partial<SearchState>) => void]>([
  { category: null, route: "", time: null, cost: null, sort: "rating" },
  () => {},
]);
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [s, set] = useState<SearchState>({ category: null, route: "", time: null, cost: null, sort: "rating" });
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
  const { data: recent } = useQuery<SearchResp>({ queryKey: ["/api/search", ""], queryFn: async () => (await apiRequest("GET", "/api/search?route=")).json() });
  const count = recent?.spots.length ?? 0;
  const fields = new Set(recent?.spots.map((x) => x.icao)).size;
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
    </div>
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

  const showTime = cat === "eat" || cat === "do";
  const showCost = cat !== "fbo";
  const bucket = TIME_BUCKETS.find((b) => b.id === s.time);

  const filtered = useMemo(() => {
    let list = (data?.spots || []).filter((x) => x.category === cat);
    if (showTime && bucket) list = list.filter((x) => totalMinutes(x) <= bucket.max);
    if (showCost && s.cost != null) list = list.filter((x) => x.costLevel <= s.cost!);
    const sorters = {
      rating: (a: SpotWithStats, b: SpotWithStats) => (b.avgRating ?? 0) - (a.avgRating ?? 0) || b.reviewCount - a.reviewCount,
      close: (a: SpotWithStats, b: SpotWithStats) => (a.milesFromField ?? 0) - (b.milesFromField ?? 0),
      new: (a: SpotWithStats, b: SpotWithStats) => b.createdAt - a.createdAt,
    };
    return [...list].sort(sorters[s.sort]);
  }, [data, cat, s.time, s.cost, s.sort, showTime, showCost]);

  const legs = data?.legs || [];
  const icaos = legs.filter((l) => l.airport).map((l) => l.airport!.icao);
  // Group by airport in route order
  const groups = useMemo(() => {
    if (!route) return [{ icao: "", label: "Latest from the network", spots: filtered }];
    return icaos
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((icao) => {
        const ap = legs.find((l) => l.airport?.icao === icao)!.airport!;
        return { icao, label: `${ap.city}${ap.region ? ", " + ap.region : ""}`, airport: ap, spots: filtered.filter((x) => x.icao === icao) };
      });
  }, [filtered, route, data]);

  const M = CAT_META[cat];
  let cardIndex = 0;

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
          {s.route && (
            <button onClick={() => set({ route: "" })} aria-label="Clear route" data-testid="button-clear-route" className="mr-2 h-8 w-8 shrink-0 grid place-items-center rounded-full hover-elevate text-muted-foreground">
              <X className="h-4 w-4" />
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
      {showCost && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Budget (up to)</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            <Chip active={s.cost == null} onClick={() => set({ cost: null })} testId="chip-cost-any">Any</Chip>
            {COST_LABELS.map((l, i) => (
              <Chip key={l} active={s.cost === i} onClick={() => set({ cost: i })} testId={`chip-cost-${i}`} className="font-code">{l}</Chip>
            ))}
          </div>
        </div>
      )}

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
                title={`No ${M.label.toLowerCase()} picks${s.time || s.cost != null ? " match these filters" : " yet"}`}
                body="Be the first crew to drop one here."
                icao={g.icao}
              />
            ) : (
              g.spots.map((spot) => {
                const i = cardIndex++;
                return (
                  <div key={spot.id} className="space-y-3">
                    <SpotCard spot={spot} />
                    {i % 4 === 3 && <AdBanner slot="inline" icaos={icaos} index={Math.floor(i / 4)} />}
                  </div>
                );
              })
            )}
          </section>
        ))
      )}

      <AdBanner slot="footer" icaos={icaos} className="mt-6" />
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
        <span className="font-code text-sm font-bold text-primary shrink-0" data-testid={`text-cost-${spot.id}`}>{COST_LABELS[spot.costLevel]}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">{spot.description}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
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
          {spot.category !== "stay" && spot.category !== "fbo" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5"><Clock className="h-3 w-3" />{fmtMinutes(totalMinutes(spot))}</span>
          )}
          {tags.slice(0, spot.category === "fbo" ? 2 : 1).map((t) => (
            <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 hidden xs:inline sm:inline">{t}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
