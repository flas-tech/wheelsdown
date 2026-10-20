import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MapPin, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
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

const refreshFollows = () => {
  for (const k of ["/api/me/following", "/api/me/followers", "/api/me/feed"]) void queryClient.invalidateQueries({ queryKey: [k] });
};
/** Follow / unfollow from the list (Joe, feedback #58), with Undo in case of a slip. */
function useFollow() {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: async (a: { u: PublicUser; follow: boolean }) => (await apiRequest(a.follow ? "POST" : "DELETE", `/api/crew/${a.u.id}/follow`)).json(),
    onSuccess: (_r, a) => {
      refreshFollows();
      if (!a.follow) toast({ title: `Unfollowed ${a.u.displayName}`, action: <ToastAction altText="Undo" onClick={() => m.mutate({ u: a.u, follow: true })} data-testid="button-unfollow-undo">Undo</ToastAction> });
    },
    onError: (e: Error) => toast({ title: "Didn't go through", description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1"), variant: "destructive" }),
  });
  return m;
}

/** Crew you follow: the list of names first (with Unfollow), then their newest listings and ratings, filterable by name. */
export default function FollowingPage() {
  const [loc, navigate] = useLocation();
  const view = loc.startsWith("/followers") ? "followers" : "following";
  const { me, loading, openAuth } = useAuth();
  const feed = useQuery<FeedItem[]>({ queryKey: ["/api/me/feed"], enabled: !!me && view === "following" });
  const people = useQuery<PublicUser[]>({ queryKey: [view === "followers" ? "/api/me/followers" : "/api/me/following"], enabled: !!me });
  // on Followers, which of them you follow back
  const mine = useQuery<PublicUser[]>({ queryKey: ["/api/me/following"], enabled: !!me && view === "followers" });
  const followingIds = new Set((view === "followers" ? mine.data : people.data)?.map((u) => u.id) || []);
  const follow = useFollow();
  const [only, setOnly] = useState<number | null>(null);
  const items = (feed.data || []).filter((it) => only == null || it.user.id === only);
  const onlyName = people.data?.find((u) => u.id === only)?.displayName;

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

      <section className="space-y-2" data-testid="section-follow-list">
        <h2 className="text-sm font-semibold">{view === "followers" ? `${people.data?.length ?? ""} following you` : `You follow ${people.data?.length ?? ""}`}</h2>
        {people.isLoading ? <Skeleton className="h-16 rounded-2xl" />
          : !people.data?.length ? <p className="text-sm text-muted-foreground">{view === "followers" ? "No followers yet. Adding spots and detailed ratings is the best way to get some." : "Nobody yet."}</p>
          : <div className="rounded-2xl border border-card-border bg-card divide-y divide-border">
              {people.data.map((u) => {
                const isF = followingIds.has(u.id);
                const busy = follow.isPending && follow.variables?.u.id === u.id;
                return (
                  <div key={u.id} className="flex items-center gap-3 px-4 py-3" data-testid={`row-follow-${u.id}`}>
                    <Link href={`/crew/${u.id}`} className="flex min-w-0 flex-1 items-center gap-3 hover:underline" data-testid={`link-follow-${u.id}`}>
                      <CrewAvatar aircraft={u.aircraft} className="h-9 w-9 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{u.displayName}</span><TierChip tierId={u.tierId} /></span>
                        <span className="block truncate text-xs text-muted-foreground">{u.crewRole}{u.homeBase ? ` · ${u.homeBase}` : ""}{u.interests?.length ? ` · ${u.interests.slice(0, 2).map((i) => INTERESTS[i]).join(", ")}` : ""}</span>
                      </span>
                    </Link>
                    {view === "following" ? (
                      <button type="button" disabled={busy} onClick={() => { if (only === u.id) setOnly(null); follow.mutate({ u, follow: false }); }}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-xs font-semibold hover-elevate disabled:opacity-50" data-testid={`button-unfollow-${u.id}`}>
                        <UserMinus className="h-3.5 w-3.5" />Unfollow
                      </button>
                    ) : isF ? (
                      <button type="button" disabled={busy} onClick={() => follow.mutate({ u, follow: false })}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-primary bg-primary/15 px-3 text-xs font-semibold hover-elevate disabled:opacity-50" data-testid={`button-unfollow-${u.id}`}>
                        <UserCheck className="h-3.5 w-3.5" />Following
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => follow.mutate({ u, follow: true })}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full taxi-sign px-3 text-xs font-semibold hover-elevate disabled:opacity-50" data-testid={`button-followback-${u.id}`}>
                        <UserPlus className="h-3.5 w-3.5" />Follow back
                      </button>
                    )}
                  </div>
                );
              })}
            </div>}
      </section>

      {view === "following" && (
        <section className="space-y-2.5" data-testid="section-feed">
          <h2 className="text-sm font-semibold">{onlyName ? `Latest from ${onlyName}` : "Latest from crews you follow"}</h2>
          {(people.data?.length || 0) > 1 && (feed.data?.length || 0) > 0 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Show activity from" data-testid="filter-feed">
              {[{ id: null as number | null, name: "Everyone" }, ...people.data!.map((u) => ({ id: u.id as number | null, name: u.displayName }))].map((c) => (
                <button key={c.id ?? 0} type="button" role="tab" aria-selected={only === c.id} onClick={() => setOnly(c.id)}
                  className={cn("h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium", only === c.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover-elevate")}
                  data-testid={`chip-feed-${c.id ?? "all"}`}>{c.name}</button>
              ))}
            </div>
          )}
          {feed.isLoading ? <Skeleton className="h-24 rounded-2xl" />
            : !items.length && only != null ? (
              <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground" data-testid="text-feed-empty-one">{onlyName || "They"} hasn't added or rated anything lately.</p>
            ) : !feed.data?.length ? (
              <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground" data-testid="text-feed-empty">
                {people.data?.length ? "The crews you follow haven't posted anything yet." : <>You're not following anyone yet. Find crews on the <Link href="/crew" className="text-primary underline">leaderboard</Link> or tap a name on any rating, then tap Follow.</>}
              </p>
            ) : items.map((it, i) => {
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

    </div>
  );
}
