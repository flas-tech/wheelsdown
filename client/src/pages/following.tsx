import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, MapPin, Star, Users } from "lucide-react";
import type { PublicUser } from "@shared/tiers";
import { INTERESTS } from "@shared/interests";
import { useAuth, TierChip } from "@/lib/auth";
import { CrewAvatar } from "@/lib/aircraft";
import { Stars, GoAroundBadge, CAT_META } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type FeedItem = {
  kind: "spot" | "review"; at: number; user: { id: number; displayName: string; aircraft: string; tierId: PublicUser["tierId"] };
  spot: { id: number; name: string; icao: string; category: keyof typeof CAT_META }; description?: string; rating?: number; comment?: string;
};
const when = (t: number) => {
  const d = (Date.now() - t) / 86400_000;
  return d < 1 ? "today" : d < 2 ? "yesterday" : d < 7 ? `${Math.floor(d)} days ago` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Crew you follow: their newest listings and ratings, plus the follow lists. */
export default function FollowingPage() {
  const [loc, navigate] = useLocation();
  const view = loc.startsWith("/followers") ? "followers" : "following";
  const { me, loading, openAuth } = useAuth();
  const feed = useQuery<FeedItem[]>({ queryKey: ["/api/me/feed"], enabled: !!me && view === "following" });
  const people = useQuery<PublicUser[]>({ queryKey: [view === "followers" ? "/api/me/followers" : "/api/me/following"], enabled: !!me });

  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!me) return (
    <div className="rounded-2xl border border-card-border bg-card p-6 text-center space-y-3">
      <Users className="mx-auto h-6 w-6 text-primary" />
      <p className="font-semibold">Follow crews you trust</p>
      <p className="text-sm text-muted-foreground">Sign in, then tap Follow on anyone's crew profile to see their new spots and ratings here.</p>
      <button onClick={() => openAuth()} className="h-11 px-6 rounded-full taxi-sign font-semibold hover-elevate" data-testid="button-following-signin">Sign in</button>
    </div>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <h1 className="text-xl font-semibold">{view === "followers" ? "Your followers" : "Following"}</h1>
        <div className="inline-flex rounded-full border border-border p-0.5" role="tablist">
          {([["/crew", "Leaderboard"], ["/following", "Following"], ["/followers", "Followers"]] as const).map(([href, label]) => (
            <button key={href} role="tab" aria-selected={loc === href} onClick={() => navigate(href)} data-testid={`tab-${label.toLowerCase()}`}
              className={cn("h-9 rounded-full px-4 text-sm font-medium", loc === href ? "bg-foreground text-background" : "text-muted-foreground")}>{label}</button>
          ))}
        </div>
      </header>

      {view === "following" && (
        <section className="space-y-2.5" data-testid="section-feed">
          <h2 className="text-sm font-semibold">Latest from crews you follow</h2>
          {feed.isLoading ? <Skeleton className="h-24 rounded-2xl" />
            : !feed.data?.length ? (
              <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground" data-testid="text-feed-empty">
                {people.data?.length ? "The crews you follow haven't posted anything yet." : <>You're not following anyone yet. Find crews on the <Link href="/crew" className="text-primary underline">leaderboard</Link> or tap a name on any rating, then tap Follow.</>}
              </p>
            ) : feed.data.map((it, i) => {
              const Icon = CAT_META[it.spot.category]?.icon || MapPin;
              return (
                <article key={`${it.kind}-${it.spot.id}-${i}`} className="rounded-2xl border border-card-border bg-card p-4 space-y-2" data-testid={`feed-${it.kind}-${it.spot.id}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <Link href={`/crew/${it.user.id}`} className="flex items-center gap-2 font-semibold hover:underline"><CrewAvatar aircraft={it.user.aircraft} className="h-7 w-7" />{it.user.displayName}</Link>
                    <span className="text-muted-foreground">{it.kind === "spot" ? "added a spot" : it.rating === 0 ? "says go around" : "rated"}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{when(it.at)}</span>
                  </div>
                  <Link href={`/spot/${it.spot.id}`} className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5 hover-elevate">
                    <Icon className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-code text-xs font-bold">{it.spot.icao}</span>
                    <span className="text-sm font-medium truncate">{it.spot.name}</span>
                    {it.kind === "review" && <span className="ml-auto shrink-0">{it.rating === 0 ? <GoAroundBadge /> : <Stars value={it.rating || 0} size={12} />}</span>}
                  </Link>
                  {(it.comment || it.description) && <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">{it.comment || it.description}</p>}
                </article>
              );
            })}
        </section>
      )}

      <section className="space-y-2" data-testid="section-follow-list">
        <h2 className="text-sm font-semibold">{view === "followers" ? `${people.data?.length ?? ""} following you` : `You follow ${people.data?.length ?? ""}`}</h2>
        {people.isLoading ? <Skeleton className="h-16 rounded-2xl" />
          : !people.data?.length ? <p className="text-sm text-muted-foreground">{view === "followers" ? "No followers yet. Adding spots and detailed ratings is the best way to get some." : "Nobody yet."}</p>
          : <div className="rounded-2xl border border-card-border bg-card divide-y divide-border">
              {people.data.map((u) => (
                <Link key={u.id} href={`/crew/${u.id}`} className="flex items-center gap-3 px-4 py-3 hover-elevate" data-testid={`row-follow-${u.id}`}>
                  <CrewAvatar aircraft={u.aircraft} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{u.displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.crewRole}{u.homeBase ? ` · ${u.homeBase}` : ""}{u.interests?.length ? ` · ${u.interests.slice(0, 2).map((i) => INTERESTS[i]).join(", ")}` : ""}</p>
                  </div>
                  <TierChip tierId={u.tierId} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>}
      </section>
    </div>
  );
}
