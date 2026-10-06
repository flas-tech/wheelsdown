import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CREW_ROLES } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { LogOut, Star, ThumbsUp, ThumbsDown, PlusCircle, MessageSquare, ShieldCheck, Award, Gift, Activity } from "lucide-react";
import { TIERS, POINTS, tierFor, publicName, type TierId, type ActivityItem } from "@shared/tiers";
import type { SpotWithStats, Review } from "@shared/schema";
import { useAuth, Insignia, tierById, PostAsToggle } from "@/lib/auth";
import { VetBadge, timeAgo } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function TierCard({ points, name, sub, tierId }: { points: number; name: string; sub?: string; tierId: TierId }) {
  const { tier, next, progress, toNext } = tierFor(points);
  const dark = tierId === "ancient_albatross" || tierId === "check_airman";
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg"
      style={{ background: dark ? `linear-gradient(135deg, #0B0F1A 0%, #1F2937 60%, ${tier.color}55 100%)` : `linear-gradient(135deg, #0B1222 0%, #172036 55%, ${tier.color}66 100%)` }}
      data-testid="card-tier"
    >
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-20" style={{ background: tier.color }} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="font-code text-[10px] tracking-[0.25em] text-white/60">WHEELSDOWN CREW STATUS</p>
          <p className="mt-1 text-xl font-semibold" style={{ color: tier.color }} data-testid="text-tier-name">{tier.name}</p>
          <p className="text-xs text-white/70">{tier.tagline}</p>
        </div>
        <Insignia tierId={tier.id} className="h-10" />
      </div>
      <div className="relative mt-6 flex items-end justify-between">
        <div>
          <p className="text-sm font-semibold">{name}</p>
          {sub && <p className="text-xs text-white/60">{sub}</p>}
        </div>
        <div className="text-right">
          <p className="font-code text-2xl font-bold tabular" data-testid="text-points">{points.toLocaleString()}</p>
          <p className="text-[11px] text-white/60">points</p>
        </div>
      </div>
      <div className="relative mt-4">
        <div className="h-1.5 rounded-full bg-white/15 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: tier.color }} /></div>
        <p className="mt-1.5 text-[11px] text-white/70" data-testid="text-next-tier">
          {next ? <>{toNext.toLocaleString()} points to <b className="text-white">{next.name}</b></> : "Top of the ladder. Thank you for keeping the network honest."}
        </p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { me, loading, logout, openAuth } = useAuth();
  const { data: contrib, isLoading } = useQuery<{ spots: SpotWithStats[]; reviews: (Review & { spotName: string })[]; activity: ActivityItem[] }>({ queryKey: ["/api/me/contributions"], enabled: !!me });

  if (loading) return <Skeleton className="h-48 rounded-3xl" />;
  if (!me)
    return (
      <div className="space-y-5">
        <TierCard points={0} name="Your name here" sub="Student · 0 contributions" tierId="student" />
        <div className="rounded-2xl border border-card-border bg-card p-5 text-center space-y-3">
          <p className="text-base font-semibold">Start your crew logbook</p>
          <p className="text-sm text-muted-foreground">Earn points for every spot you add, rating you leave and vote you cast. Climb from Student to Ancient Albatross.</p>
          <button onClick={() => openAuth()} data-testid="button-profile-signin" className="h-11 px-6 rounded-full taxi-sign font-semibold hover-elevate">Create account or sign in</button>
        </div>
        <TierLadder points={0} signedIn={false} />
      </div>
    );

  const b = me.breakdown;
  const rows = [
    { icon: PlusCircle, label: "Listings added", n: b.listings, each: POINTS.listing },
    { icon: ShieldCheck, label: "Listings that became Crew-vetted", n: b.listingsVetted, each: POINTS.listingVetted },
    { icon: Star, label: "Ratings & reviews", n: b.reviews, each: POINTS.review },
    { icon: MessageSquare, label: "Detailed reviews (40+ characters)", n: b.detailedReviews, each: POINTS.reviewDetail },
    { icon: ThumbsUp, label: "Votes cast", n: b.votes, each: POINTS.vote },
    { icon: ThumbsUp, label: "Upvotes on your listings", n: b.upvotesReceived, each: POINTS.upvoteReceived },
    { icon: Award, label: "Helpful votes on your reviews", n: b.helpfulReceived, each: POINTS.helpfulReceived },
  ];
  return (
    <div className="space-y-5">
      <TierCard points={me.points} name={me.displayName} sub={`@${me.handle} · ${me.crewRole}${me.homeBase ? " · " + me.homeBase : ""}`} tierId={me.tierId} />

      <Participation b={b} />

      <ProfileSettings />

      <ActivityLog items={contrib?.activity} loading={isLoading} />

      <section className="rounded-2xl border border-card-border bg-card">
        <h2 className="px-4 pt-4 text-sm font-semibold">How you earned it</h2>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <r.icon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{r.label}</span>
              <span className="text-xs text-muted-foreground tabular">{r.n} × {r.each}</span>
              <span className="w-14 text-right font-code font-bold tabular">{(r.n * r.each).toLocaleString()}</span>
            </li>
          ))}
          {b.bonus > 0 && (
            <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Gift className="h-4 w-4 text-muted-foreground" /><span className="flex-1">Bonus points</span>
              <span className="w-14 text-right font-code font-bold tabular">{b.bonus.toLocaleString()}</span>
            </li>
          )}
          <li className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
            <span>Total</span><span className="font-code tabular" data-testid="text-points-total">{me.points.toLocaleString()}</span>
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-card-border bg-card p-4">
        <h2 className="text-sm font-semibold">Your {tierById(me.tierId).name} perks</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          {tierById(me.tierId).perks.map((p) => <li key={p} className="flex gap-2"><span className="text-primary">•</span><span className={cn(p.includes("(planned)") && "text-muted-foreground")}>{p}</span></li>)}
        </ul>
      </section>

      <TierLadder points={me.points} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Your listings</h2>
        {isLoading && <Skeleton className="h-16 rounded-xl" />}
        {contrib?.spots.length === 0 && <p className="text-sm text-muted-foreground">None yet. <Link href="/add" className="text-primary underline">Add your first spot</Link> for {POINTS.listing} points.</p>}
        {contrib?.spots.map((s) => (
          <Link key={s.id} href={`/spot/${s.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-3 py-2.5 hover-elevate" data-testid={`link-my-spot-${s.id}`}>
            <span className="min-w-0"><span className="font-code text-xs font-bold mr-2">{s.icao}</span><span className="text-sm font-medium">{s.name}</span></span>
            <VetBadge vet={s.vet} />
          </Link>
        ))}
      </section>
      {contrib && contrib.reviews.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Your reviews</h2>
          {contrib.reviews.map((r) => (
            <Link key={r.id} href={`/spot/${r.spotId}`} className="block rounded-xl border border-card-border bg-card px-3 py-2.5 hover-elevate">
              <p className="text-sm font-medium">{r.spotName} <span className="text-primary">{"★".repeat(r.rating)}</span></p>
              {r.comment && <p className="text-xs text-muted-foreground line-clamp-1">{r.comment}</p>}
            </Link>
          ))}
        </section>
      )}

      <button onClick={logout} data-testid="button-logout" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><LogOut className="h-4 w-4" />Sign out</button>
    </div>
  );
}

function Participation({ b }: { b: { participation: number; listings: number; reviews: number; votes: number } }) {
  const cells = [
    { label: "Listings", n: b.listings, icon: PlusCircle },
    { label: "Ratings", n: b.reviews, icon: Star },
    { label: "Votes", n: b.votes, icon: ThumbsUp },
  ];
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="section-participation">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Activity className="h-4 w-4 text-primary" />Participation</h2>
        <p><span className="font-code text-2xl font-bold tabular" data-testid="text-participation">{b.participation.toLocaleString()}</span> <span className="text-xs text-muted-foreground">{b.participation === 1 ? "contribution" : "contributions"}</span></p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl bg-muted/60 px-3 py-2">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1"><c.icon className="h-3 w-3" />{c.label}</p>
            <p className="font-code text-lg font-bold tabular" data-testid={`text-count-${c.label.toLowerCase()}`}>{c.n}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileSettings() {
  const { me } = useAuth();
  const { toast } = useToast();
  const [f, setF] = useState({ displayName: "", crewRole: "Pilot", homeBase: "", anonymous: false });
  useEffect(() => { if (me) setF({ displayName: me.displayName, crewRole: me.crewRole, homeBase: me.homeBase, anonymous: me.anonymous }); }, [me?.id, me?.displayName, me?.crewRole, me?.homeBase, me?.anonymous]);
  const dirty = !!me && (f.displayName !== me.displayName || f.crewRole !== me.crewRole || f.homeBase !== me.homeBase || f.anonymous !== me.anonymous);
  const m = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/me", f)).json(),
    onSuccess: (next) => {
      queryClient.setQueryData(["/api/me"], next);
      queryClient.invalidateQueries();
      toast({ title: "Profile saved", description: `Your posts now read "${publicName(next)}".` });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const inputCls = "w-full h-11 rounded-xl border border-input bg-background px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  if (!me) return null;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4 space-y-3" data-testid="section-profile-settings">
      <div>
        <h2 className="text-sm font-semibold">Profile</h2>
        <p className="text-xs text-muted-foreground">Set once. Every rating and listing uses these automatically.</p>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Name</span>
        <input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} data-testid="input-profile-name" className={inputCls + " mt-1"} />
      </label>
      <div>
        <span className="text-xs font-medium text-muted-foreground">Position</span>
        <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {CREW_ROLES.map((r) => (
            <button key={r} type="button" onClick={() => setF({ ...f, crewRole: r })} aria-pressed={f.crewRole === r} data-testid={`button-role-${r.replace(/\s/g, "-").toLowerCase()}`}
              className={cn("h-10 rounded-xl border text-sm font-medium", f.crewRole === r ? "border-primary bg-primary/10" : "border-input text-muted-foreground")}>{r}</button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Home base (optional)</span>
        <input value={f.homeBase} onChange={(e) => setF({ ...f, homeBase: e.target.value.toUpperCase().slice(0, 4) })} placeholder="KMIA" data-testid="input-profile-base" className={inputCls + " mt-1 font-code uppercase w-32"} />
      </label>
      <PostAsToggle anonymous={f.anonymous} onChange={(a) => setF({ ...f, anonymous: a })} name={f.displayName || "Your name"} role={f.crewRole} />
      <button disabled={!dirty || m.isPending} onClick={() => m.mutate()} data-testid="button-profile-save" className="h-10 px-5 rounded-full taxi-sign text-sm font-semibold hover-elevate disabled:opacity-40">
        {m.isPending ? "Saving…" : "Save profile"}
      </button>
      {f.anonymous !== me.anonymous && <p className="text-[11px] text-muted-foreground">Changing this also updates the name on everything you've already posted.</p>}
    </section>
  );
}

const ACT_ICON = { listing: PlusCircle, review: Star, vote_up: ThumbsUp, vote_down: ThumbsDown, review_vote: MessageSquare } as const;
function ActivityLog({ items, loading }: { items?: ActivityItem[]; loading: boolean }) {
  return (
    <section className="rounded-2xl border border-card-border bg-card" data-testid="section-activity">
      <h2 className="px-4 pt-4 text-sm font-semibold">Recent activity</h2>
      {loading && <div className="p-4"><Skeleton className="h-10" /></div>}
      {items && items.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Nothing yet. Rate a spot or vote on a listing to start your log.</p>}
      <ul className="divide-y divide-border">
        {items?.slice(0, 12).map((a, i) => {
          const Icon = ACT_ICON[a.kind];
          return (
            <li key={i}>
              <Link href={`/spot/${a.spotId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover-elevate" data-testid={`row-activity-${i}`}>
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate">{a.label}</span>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo(a.at)}</span>
                <span className="w-10 text-right font-code text-xs font-bold text-primary tabular">+{a.points}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TierLadder({ points, signedIn = true }: { points: number; signedIn?: boolean }) {
  const cur = signedIn ? tierFor(points).index : -1;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="section-ladder">
      <h2 className="text-sm font-semibold">The ratings ladder</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        {POINTS.listing} pts per listing (+{POINTS.listingVetted} when it's Crew-vetted) · {POINTS.review} per rating (+{POINTS.reviewDetail} if detailed) · {POINTS.vote} per vote · points when others upvote your work
      </p>
      <ol className="mt-3 space-y-1">
        {TIERS.map((t, i) => (
          <li key={t.id} className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2", i === cur && "bg-primary/10 ring-1 ring-primary/40")} data-testid={`row-tier-${t.id}`}>
            <Insignia tierId={t.id} className="h-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ color: i <= cur ? t.color : undefined }}>{t.name}{i === cur && <span className="ml-2 text-[10px] font-semibold uppercase text-primary">You</span>}</p>
              <p className="text-[11px] text-muted-foreground truncate">{t.perks[0]}</p>
            </div>
            <span className="font-code text-xs tabular text-muted-foreground">{t.min.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
