import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Heart, ClipboardList, Search, X } from "lucide-react";
import type { SpotWithStats } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotCard } from "./home";

export default function FavoritesPage() {
  const { me, openAuth } = useAuth();
  const { data, isLoading } = useQuery<SpotWithStats[]>({ queryKey: ["/api/me/favorites"], enabled: !!me });
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data || []).filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.icao.toLowerCase().includes(needle) || (s.airport?.city || "").toLowerCase().includes(needle));
    const by = new Map<string, SpotWithStats[]>();
    for (const s of list) by.set(s.icao, [...(by.get(s.icao) || []), s]);
    return Array.from(by, ([icao, spots]) => ({ icao, airport: spots[0].airport, spots })).sort((a, b) => a.icao.localeCompare(b.icao));
  }, [data, q]);

  if (!me) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Favorites</h1>
        <div className="rounded-2xl border border-card-border bg-card p-5 text-center space-y-3">
          <Heart className="mx-auto h-8 w-8 text-rose-500" />
          <p className="text-sm text-muted-foreground">Save the places you go back to. Favorites are private to you and always appear in your trip briefings for that airport.</p>
          <button type="button" onClick={() => openAuth("Sign in to see your favorites.")} className="h-10 px-5 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-favorites-signin">Sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Favorites</h1>
        <p className="text-sm text-muted-foreground mt-1">Private to you. Every favorite is always included in your trip briefings for its airport.</p>
      </header>

      {(data?.length || 0) > 4 && (
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, airport or city" data-testid="input-favorites-filter"
            className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-8 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          {q && <button type="button" aria-label="Clear" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"><X className="h-4 w-4" /></button>}
        </label>
      )}

      {isLoading && <div className="space-y-3"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" /></div>}

      {!isLoading && !data?.length && (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center space-y-2" data-testid="text-favorites-empty">
          <Heart className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="text-sm font-medium">No favorites yet</p>
          <p className="text-xs text-muted-foreground">Tap the heart on any spot to save it here.</p>
          <Link href="/" className="inline-block mt-1 text-sm font-medium text-primary">Find spots</Link>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.icao} className="space-y-2" data-testid={`group-favorites-${g.icao}`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-sm">
              <span className="font-code font-bold rounded-md taxi-sign px-1.5 py-0.5">{g.icao}</span>
              <span className="truncate text-muted-foreground">{g.airport?.city || g.airport?.name || ""}</span>
            </h2>
            <Link href="/brief/new" onClick={() => sessionStorage.setItem("wd-brief-prefill", g.icao)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary" data-testid={`link-favorites-brief-${g.icao}`}>
              <ClipboardList className="h-3.5 w-3.5" /> Brief {g.icao}
            </Link>
          </div>
          <div className="space-y-2.5">{g.spots.map((s) => <SpotCard key={s.id} spot={s} />)}</div>
        </section>
      ))}
      {q && groups.length === 0 && data?.length ? <p className="text-sm text-muted-foreground">No favorites match "{q}".</p> : null}
    </div>
  );
}
