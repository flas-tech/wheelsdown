// Rate a spot (Version 0, admins only): places you've been to, planned or saved that you haven't rated yet,
// plus a quick way to find any listing at an airport and rate it.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BedDouble, Car, CheckCircle2, Compass, Heart, Loader2, MapPin, PlaneLanding, Plane, Search, Star, Utensils } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { openVisits } from "@/lib/visits";
import { PreviewBadge, PreviewGate, ago, errMsg } from "@/lib/preview";
import { POINTS } from "@shared/tiers";
import type { RateItem } from "@shared/layover";
import type { SpotWithStats } from "@shared/schema";

export default function RatePage() { return <PreviewGate><Rate /></PreviewGate>; }

const CAT_ICON: Record<string, typeof Utensils> = { eat: Utensils, do: Compass, stay: BedDouble, fbo: PlaneLanding, car: Car };
const WHY_ICON = { checkin: PlaneLanding, visit: MapPin, briefing: Plane, favorite: Heart } as const;

function Rate() {
  const visits = openVisits().map((v) => `${v.id}:${v.at}`).join(",");
  const { data, isLoading, error } = useQuery<RateItem[]>({
    queryKey: ["/api/preview/rate-queue", visits], queryFn: async () => (await apiRequest("GET", `/api/preview/rate-queue${visits ? `?visits=${visits}` : ""}`)).json(), staleTime: 30_000, retry: false,
  });
  const [typed, setTyped] = useState("");
  const [icao, setIcao] = useState("");
  const { data: found, isFetching: finding } = useQuery<{ spots: SpotWithStats[] }>({
    queryKey: ["/api/search", icao], queryFn: async () => (await apiRequest("GET", `/api/search?route=${icao}`)).json(), enabled: icao.length >= 3, staleTime: 120_000,
  });
  const waiting = new Set((data || []).map((x) => x.id));
  const atField = (found?.spots || []).filter((s) => s.status === "live").sort((a, b) => a.name.localeCompare(b.name));
  const groups = (["checkin", "visit", "briefing", "favorite"] as const).map((r) => ({ r, items: (data || []).filter((x) => x.reason === r) })).filter((g) => g.items.length);
  const title = { checkin: "You checked in", visit: "You looked these up", briefing: "From your briefings", favorite: "In your favorites" } as const;

  return (
    <div className="space-y-5" data-testid="page-rate">
      <header className="space-y-1">
        <PreviewBadge />
        <h1 className="text-xl font-semibold">Rate a spot</h1>
        <p className="text-sm text-muted-foreground">Places you've been to, planned or saved, waiting for your rating. +{POINTS.review} pts each, more with a comment.</p>
      </header>

      {isLoading ? <div className="grid place-items-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : error ? <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">{errMsg(error)}</p>
        : !groups.length ? (
          <p className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-rate-empty"><CheckCircle2 className="h-4 w-4 text-emerald-600" />You're all caught up. Find a place below to rate it.</p>
        ) : groups.map((g) => {
          const Why = WHY_ICON[g.r];
          return (
            <section key={g.r} className="space-y-2" data-testid={`section-rate-${g.r}`}>
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Why className="h-3.5 w-3.5" />{title[g.r]} <span className="tabular">· {g.items.length}</span></h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card">
                {g.items.map((x) => <Row key={x.id} id={x.id} name={x.name} icao={x.icao} category={x.category} avg={x.avgRating} n={x.reviewCount} sub={g.r === "briefing" ? x.detail.replace(/^In your briefing /, "") : ago(x.at)} />)}
              </ul>
            </section>
          );
        })}

      <section className="space-y-2" data-testid="section-rate-find">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Search className="h-3.5 w-3.5" />Find a place to rate</h2>
        <form onSubmit={(e) => { e.preventDefault(); const v = typed.trim().toUpperCase(); if (v.length >= 3) setIcao(v); }} className="flex gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={4} placeholder="Airport, e.g. MIA" className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 font-code text-base uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70" data-testid="input-rate-airport" aria-label="Airport" />
          <button type="submit" disabled={typed.trim().length < 3} className="h-11 rounded-xl taxi-sign px-4 text-sm font-semibold hover-elevate disabled:opacity-60" data-testid="button-rate-find">Find</button>
        </form>
        {icao && (finding ? <div className="grid place-items-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          : atField.length ? <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card" data-testid="list-rate-found">
              {atField.map((s) => <Row key={s.id} id={s.id} name={s.name} icao={s.icao} category={s.category} avg={s.avgRating ?? null} n={s.reviewCount} sub={waiting.has(s.id) ? "Waiting for your rating" : s.milesFromField ? `${s.milesFromField} mi from the field` : ""} />)}
            </ul>
          : <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">No crew listings at {icao} yet. <Link href={`/add/${icao}`} className="font-semibold text-foreground underline">Add one</Link></p>)}
      </section>
    </div>
  );
}

function Row({ id, name, icao, category, avg, n, sub }: { id: number; name: string; icao: string; category: string; avg: number | null; n: number; sub: string }) {
  const Icon = CAT_ICON[category] || Star;
  return (
    <li className="flex items-center gap-3 px-4 py-3" data-testid={`row-rate-${id}`}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Link href={`/spot/${id}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground"><span className="font-code">{icao}</span>{avg != null ? ` · ${avg.toFixed(1)} ★ (${n})` : " · No ratings yet"}{sub ? ` · ${sub}` : ""}</span>
      </Link>
      <Link href={`/spot/${id}?rate=1`} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full taxi-sign px-3.5 text-xs font-semibold hover-elevate" data-testid={`link-rate-${id}`}><Star className="h-3.5 w-3.5" />Rate</Link>
    </li>
  );
}
