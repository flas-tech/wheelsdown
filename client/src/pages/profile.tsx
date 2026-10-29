import { AircraftPicker, CrewAvatar } from "@/lib/aircraft";
import { InterestPicker, InterestChips } from "@/lib/interests";
import { ProfileChecklist } from "@/lib/profileGaps";
import { TourLink } from "@/lib/tour";
import { WrightCard } from "@/lib/club";
import { BadgeProgressGrid } from "@/lib/achievements";
import { FeedbackCard } from "@/lib/feedback";
import { LogbookTabs } from "@/pages/notifications";
import { AirportCheckInCard, CheckInList, ProfileMap } from "@/lib/checkins";
import { InviteCard } from "@/lib/share";
import { AiPrefCard, ProgramsCard } from "@/lib/aiPicks";
import { VersionCard } from "@/lib/version";
import { setExperience, useAdminOnly, useExperience, usePreview, useTripState, useRankArt } from "@/lib/experience";
import { Switch } from "@/components/ui/switch";
import { BIO_MAX } from "@shared/interests";
import { aircraftList } from "@shared/aircraft";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CREW_ROLES } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Settings, Star, ThumbsUp, ThumbsDown, PlusCircle, MessageSquare, ShieldCheck, Award, Gift, Activity, ChevronRight, UserPlus, CircleHelp } from "lucide-react";
import { TIERS, POINTS, tierFor, publicName, SOLO_POINTS, hasSoloed, type TierId, type ActivityItem } from "@shared/tiers";
import type { SpotWithStats, Review } from "@shared/schema";
import { useAuth, Insignia, tierById, PostAsToggle } from "@/lib/auth";
import { VetBadge, timeAgo } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Rank mascot (pelican art per rank). Shown only while rank_art_audience lets this account see it. */
export function RankMascot({ tierId, className }: { tierId: TierId; className?: string }) {
  const t = tierById(tierId);
  return <img src={`./ranks/${t.id}.webp`} alt={`${t.name} mascot`} width={160} height={160} decoding="async" className={cn("shrink-0 rounded-full", className)} data-testid={`img-rank-${t.id}`} />;
}

export function TierCard({ points, name, sub, tierId, aircraft }: { points: number; name: string; sub?: string; tierId: TierId; aircraft?: string }) {
  const { tier, next, progress, toNext } = tierFor(points);
  const student = tier.id === "student";
  const soloed = student && hasSoloed(points);
  const dark = tierId === "grand_pelican" || tierId === "chief_pilot" || tierId === "check_airman";
  const art = useRankArt();
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
          <p className="text-xs text-white/70">{soloed ? "Solo endorsed. Cross-country next." : tier.tagline}</p>
          {art.on && <p className="mt-1 max-w-[15rem] text-[11px] leading-snug text-white/85" data-testid="text-tier-role">{tier.role}{art.adminOnly && <span className="ml-1.5 rounded bg-white/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-white/70">Admins only</span>}</p>}
          {soloed && <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" data-testid="badge-soloed">Soloed</span>}
        </div>
        {art.on ? <div className="flex shrink-0 flex-col items-center gap-1"><RankMascot tierId={tier.id} className="h-16 w-16 ring-2 ring-white/20" /><Insignia tierId={tier.id} className="h-4" /></div> : <Insignia tierId={tier.id} className="h-10" />}
      </div>
      <div className="relative mt-6 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {aircraft !== undefined && <CrewAvatar aircraft={aircraft} dark className="h-11 w-11" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{name}</p>
            {sub && <p className="text-xs text-white/60">{sub}</p>}
            {aircraftList(aircraft).length > 0 && <p className="text-[11px] text-white/50" data-testid="text-aircraft">Aircraft: {aircraftList(aircraft).map((x) => x.label).join(", ")}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-code text-2xl font-bold tabular" data-testid="text-points">{points.toLocaleString()}</p>
          <p className="text-[11px] text-white/60">points</p>
        </div>
      </div>
      <div className="relative mt-4">
        <div className="relative">
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: tier.color }} /></div>
          {student && next && (
            <span className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 rounded bg-white/70" style={{ left: `${(SOLO_POINTS / next.min) * 100}%` }} title={`Solo at ${SOLO_POINTS} points`} aria-hidden />
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-white/70" data-testid="text-next-tier">
          {student && !soloed ? <>{(SOLO_POINTS - points).toLocaleString()} points to your <b className="text-white">solo</b> · {toNext.toLocaleString()} to <b className="text-white">{next!.name}</b></>
            : next ? <>{toNext.toLocaleString()} points to <b className="text-white">{next.name}</b></> : "Top of the ladder. Thank you for keeping the network honest."}
        </p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { me, loading, openAuth } = useAuth();
  const { data: contrib, isLoading } = useQuery<{ spots: (SpotWithStats & { mod?: { state: string; note: string; editPending: boolean } })[]; reviews: (Review & { spotName: string })[]; activity: ActivityItem[] }>({
    queryKey: ["/api/me/contributions"], enabled: !!me,
    refetchInterval: (q) => (q.state.data?.spots.some((s) => s.mod?.state === "checking") || q.state.data?.reviews.some((r) => r.modState === "checking") ? 5000 : false),
  });

  if (loading) return <Skeleton className="h-48 rounded-3xl" />;
  if (!me)
    return (
      <div className="space-y-5">
        <TierCard points={0} name="Your name here" sub="Student · 0 contributions" tierId="student" />
        <div className="rounded-2xl border border-card-border bg-card p-5 text-center space-y-3">
          <p className="text-base font-semibold">Start your crew logbook</p>
          <p className="text-sm text-muted-foreground">Earn points for every spot you add, rating you leave and vote you cast. Climb from Student to Grand Pelican.</p>
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
    { icon: UserPlus, label: "Crew who signed up with your invite", n: b.referrals || 0, each: POINTS.referral },
  ];
  return (
    <div className="space-y-5">
      <LogbookTabs />
      <TierCard points={me.points} name={me.displayName} sub={`@${me.handle} · ${me.crewRole}${me.homeBase ? " · " + me.homeBase : ""}`} tierId={me.tierId} aircraft={me.aircraft || ""} />
      <ProfileChecklist />
      {me.wrightNo && <WrightCard no={me.wrightNo} />}
      {(me.bio || me.interests?.length || me.follows) && (
        <div className="space-y-2.5" data-testid="section-my-about">
          {me.bio && <p className="text-sm whitespace-pre-line" data-testid="text-my-bio">{me.bio}</p>}
          <InterestChips ids={me.interests || []} />
          {me.follows && !me.anonymous && (
            <p className="text-sm text-muted-foreground">
              <Link href="/following" className="hover:text-foreground" data-testid="link-my-following"><span className="font-semibold text-foreground tabular">{me.follows.following}</span> following</Link>
              <span className="mx-2">·</span>
              <Link href="/followers" className="hover:text-foreground" data-testid="link-my-followers"><span className="font-semibold text-foreground tabular">{me.follows.followers}</span> followers</Link>
            </p>
          )}
        </div>
      )}

      <Participation b={b} />

      <ProfileMap own />
      <AirportCheckInCard />
      <CheckInList />

      {me.isAdmin && (
        <Link href="/admin" className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4 hover-elevate" data-testid="link-admin-console">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><ShieldCheck className="h-5 w-5 text-primary" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Admin console</p>
            <p className="text-xs text-muted-foreground">Moderation, listings, ads and advertiser metrics. Super-user access.</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      )}

      {me.achievements && <BadgeProgressGrid progress={me.achievements} />}
      <InviteCard refId={me.id} referrals={b.referrals || 0} />
      <FeedbackCard />
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
            {s.mod?.state === "checking" ? <ModChip kind="checking" /> : s.mod?.state === "flagged" ? <ModChip kind={s.mod.editPending ? "edit_held" : "held"} /> : s.status === "rejected" ? <ModChip kind="removed" /> : s.status === "pending" || s.mod?.state === "awaiting" ? <ModChip kind="waiting" /> : <VetBadge vet={s.vet} />}
          </Link>
        ))}
      </section>
      {contrib && contrib.reviews.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Your reviews</h2>
          {contrib.reviews.map((r) => (
            <Link key={r.id} href={`/spot/${r.spotId}`} className="block rounded-xl border border-card-border bg-card px-3 py-2.5 hover-elevate">
              <p className="text-sm font-medium">{r.spotName} {r.rating === 0 ? <span className="text-orange-600 dark:text-orange-400 text-xs font-semibold">Go around</span> : <span className="text-primary">{"★".repeat(r.rating)}</span>}</p>
              {r.comment && <p className="text-xs text-muted-foreground line-clamp-1">{r.comment}</p>}
              {(r.modState === "checking" || r.modState === "flagged" || r.modState === "awaiting" || r.status === "rejected") && <span className="mt-1 inline-block"><ModChip kind={r.status === "rejected" ? "removed" : r.modState === "checking" ? "checking" : r.modState === "awaiting" ? "waiting" : r.pendingEdit ? "edit_held" : "held"} /></span>}
            </Link>
          ))}
        </section>
      )}

      <Link href="/settings" className="flex items-center justify-between gap-3 rounded-2xl border border-card-border bg-card px-4 py-3 hover-elevate" data-testid="link-me-settings">
        <span className="flex items-center gap-3"><Settings className="h-5 w-5 text-primary" /><span><span className="block text-sm font-semibold">Settings</span><span className="block text-xs text-muted-foreground">Profile, notifications, AI picks, hotel programs, sign out</span></span></span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
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

export function ProfileSettings() {
  const { me } = useAuth();
  const { toast } = useToast();
  const [f, setF] = useState({ displayName: "", crewRole: "Pilot", homeBase: "", anonymous: false, email: "", aircraft: "", bio: "", interests: [] as string[] });
  const meInterests = (me?.interests || []).join(",");
  useEffect(() => { if (me) setF({ displayName: me.displayName, crewRole: me.crewRole, homeBase: me.homeBase, anonymous: me.anonymous, email: me.email || "", aircraft: me.aircraft || "", bio: me.bio || "", interests: me.interests || [] }); }, [me?.id, me?.displayName, me?.crewRole, me?.homeBase, me?.anonymous, me?.email, me?.aircraft, me?.bio, meInterests]);
  const dirty = !!me && (f.displayName !== me.displayName || f.crewRole !== me.crewRole || f.homeBase !== me.homeBase || f.anonymous !== me.anonymous || f.email !== (me.email || "") || f.aircraft !== (me.aircraft || "") || f.bio.trim() !== (me.bio || "") || f.interests.join(",") !== meInterests);
  const m = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/me", { ...f, bio: f.bio.trim() })).json(),
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
        <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {CREW_ROLES.map((r) => (
            <button key={r} type="button" onClick={() => setF({ ...f, crewRole: r })} aria-pressed={f.crewRole === r} data-testid={`button-role-${r.replace(/\s/g, "-").toLowerCase()}`}
              className={cn("h-10 rounded-xl border text-sm font-medium", f.crewRole === r ? "border-primary bg-primary/10" : "border-input text-muted-foreground")}>{r}</button>
          ))}
        </div>
      </div>
      <div id="pf-aircraft" className="scroll-mt-24">
        <span className="text-xs font-medium text-muted-foreground">Aircraft you fly <span className="font-normal">· shown on your profile; your avatar appears next to your name</span></span>
        <div className="mt-1"><AircraftPicker value={f.aircraft} onChange={(a) => setF({ ...f, aircraft: a })} /></div>
      </div>
      <label className="block scroll-mt-24" id="pf-bio">
        <span className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
          <span>About you <span className="font-normal">· public, shown on your crew profile</span></span>
          <span className={cn("font-normal tabular", f.bio.length > BIO_MAX - 20 && "text-foreground")}>{f.bio.length}/{BIO_MAX}</span>
        </span>
        <textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value.slice(0, BIO_MAX) })} rows={3} maxLength={BIO_MAX} data-testid="input-profile-bio"
          placeholder="CJ3 captain out of OPF. Always hunting the best slice near the FBO."
          className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
        <span className="text-[11px] text-muted-foreground">No links, phone numbers or emails. It's checked before it's saved.</span>
      </label>
      <div id="pf-interests" className="scroll-mt-24">
        <span className="text-xs font-medium text-muted-foreground">Your expertise <span className="font-normal">· pick up to 5 badges for your profile</span></span>
        <div className="mt-1.5"><InterestPicker value={f.interests} onChange={(v) => setF({ ...f, interests: v })} /></div>
      </div>
      <label className="block scroll-mt-24" id="pf-base">
        <span className="text-xs font-medium text-muted-foreground">Home base (optional)</span>
        <input value={f.homeBase} onChange={(e) => setF({ ...f, homeBase: e.target.value.toUpperCase().slice(0, 4) })} placeholder="KMIA" data-testid="input-profile-base" className={inputCls + " mt-1 font-code uppercase w-32"} />
        <span className="mt-1 block text-[11px] text-muted-foreground">Any code works (OPF, MIA). It's saved as the 4-letter ICAO code so every crew uses the same one.</span>
      </label>
      <label className="block scroll-mt-24" id="pf-email">
        <span className="text-xs font-medium text-muted-foreground">Email (private, for password reset)</span>
        <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value.trim() })} placeholder="you@example.com" autoComplete="email" data-testid="input-profile-email" className={inputCls + " mt-1"} />
      </label>
      <PostAsToggle anonymous={f.anonymous} onChange={(a) => setF({ ...f, anonymous: a })} name={f.displayName || "Your name"} role={f.crewRole} />
      <button disabled={!dirty || m.isPending} onClick={() => m.mutate()} data-testid="button-profile-save" className="h-10 px-5 rounded-full taxi-sign text-sm font-semibold hover-elevate disabled:opacity-40">
        {m.isPending ? "Saving…" : "Save profile"}
      </button>
      {f.anonymous !== me.anonymous && <p className="text-[11px] text-muted-foreground">Changing this also updates the name on everything you've already posted.</p>}
      {f.anonymous && <p className="text-[11px] text-muted-foreground">While you post anonymously, your bio, badges and followers stay hidden and nobody can follow you.</p>}
    </section>
  );
}

const ACT_ICON = { listing: PlusCircle, review: Star, vote_up: ThumbsUp, vote_down: ThumbsDown, review_vote: MessageSquare, referral: UserPlus } as const;
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
              <Link href={a.kind === "referral" ? "/crew" : `/spot/${a.spotId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover-elevate" data-testid={`row-activity-${i}`}>
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
  const art = useRankArt();
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="section-ladder">
      <h2 className="text-sm font-semibold">The ratings ladder</h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        {POINTS.listing} pts per listing (+{POINTS.listingVetted} when it's Crew-vetted) · {POINTS.review} per rating (+{POINTS.reviewDetail} if detailed) · {POINTS.vote} per vote · {POINTS.referral} per crew member who signs up with your invite link · points when others upvote your work
      </p>
      {art.adminOnly && <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary" data-testid="text-rank-art-admin">Rank mascots: admins only</p>}
      <ol className="mt-3 space-y-1">
        {TIERS.map((t, i) => (
          <li key={t.id} className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2", i === cur && "bg-primary/10 ring-1 ring-primary/40")} data-testid={`row-tier-${t.id}`}>
            {art.on ? <RankMascot tierId={t.id} className="h-11 w-11" /> : <Insignia tierId={t.id} className="h-6 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: i <= cur ? t.color : undefined }}>{t.name}{art.on && <Insignia tierId={t.id} className="h-3.5 shrink-0" />}{i === cur && <span className="ml-0.5 text-[10px] font-semibold uppercase text-primary">You</span>}</p>
              {art.on ? <p className="text-[11px] leading-snug text-foreground/80" data-testid={`text-tier-role-${t.id}`}>{t.role}</p> : null}
              <p className="text-[11px] text-muted-foreground truncate">{t.perks[0]}</p>
            </div>
            <span className="font-code text-xs tabular text-muted-foreground">{t.min.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DeleteAccount() {
  const { me, logout } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const m = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", "/api/me", { confirm })).json(),
    onSuccess: async () => { await logout(); toast({ title: "Account deleted", description: "Your account, ratings, comments and votes have been removed." }); },
    onError: (e: Error) => { const t = e.message.replace(/^\d+:\s*/, ""); let d = t; try { d = JSON.parse(t).message; } catch {} toast({ title: "Couldn't delete", description: d, variant: "destructive" }); },
  });
  if (!me) return null;
  return (
    <section className="rounded-2xl border border-destructive/30 p-4 space-y-2" data-testid="section-delete-account">
      <h2 className="text-sm font-semibold">Delete account</h2>
      <p className="text-xs text-muted-foreground">Permanently deletes your account, ratings, comments, votes and points. Listings you added stay up as community content, credited to "Former crew member." This can't be undone.</p>
      {!open ? (
        <button onClick={() => setOpen(true)} data-testid="button-delete-account" className="h-9 px-4 rounded-full border border-destructive/50 text-destructive text-sm font-medium hover-elevate">Delete my account</button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">Type your handle <span className="font-code text-foreground">{me.handle}</span> to confirm
            <input value={confirm} onChange={(e) => setConfirm(e.target.value.toLowerCase().trim())} autoCapitalize="none" data-testid="input-delete-confirm"
              className="mt-1 w-full h-10 rounded-xl border border-input bg-background px-3 text-base sm:text-sm font-code focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <div className="flex gap-2">
            <button disabled={confirm !== me.handle || m.isPending} onClick={() => m.mutate()} data-testid="button-delete-confirm" className="h-9 px-4 rounded-full bg-destructive text-destructive-foreground text-sm font-semibold disabled:opacity-40">{m.isPending ? "Deleting…" : "Permanently delete"}</button>
            <button onClick={() => { setOpen(false); setConfirm(""); }} className="h-9 px-4 rounded-full text-sm text-muted-foreground">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ModChip({ kind }: { kind: "checking" | "held" | "edit_held" | "waiting" | "removed" }) {
  const label = { checking: "Being checked", held: "On hold: tap to see why", edit_held: "Edit on hold", waiting: "Awaiting moderator", removed: "Removed by moderator" }[kind];
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", kind === "checking" ? "bg-primary/15 text-primary" : "bg-orange-500/15 text-orange-700 dark:text-orange-300")} data-testid={`chip-mod-${kind}`}>{label}</span>;
}

/** Admins only: try the landing page and tailored navigation before members get it. */
export function PreviewCard() {
  const exp = useExperience();
  const { me } = useAuth();
  const on = usePreview();
  const adminOnly = useAdminOnly();
  const names = { plan: "Plan a layover", spots: "Find spots", lounge: "Crew Lounge" } as const;
  const trip = useTripState();
  if (trip.on) return <TripCardAdmin adminOnly={trip.adminOnly} admin={!!me?.isAdmin} />;
  if (!on) return null;
  return (
    <section className={cn("rounded-2xl bg-card px-4 py-3", adminOnly ? "border border-dashed border-primary/60" : "border border-card-border")} data-testid="card-preview-start">
      {adminOnly && <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Admin preview</p>}
      <p className="mt-0.5 text-sm font-semibold">Home screen</p>
      <p className="text-xs text-muted-foreground">{exp ? `You're in ${names[exp]}. ` : ""}Pick what you're here for and the navigation changes to match.{adminOnly ? " Members don't see this yet." : ""}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/start" className="inline-flex h-9 items-center rounded-full taxi-sign px-3.5 text-xs font-semibold hover-elevate" data-testid="link-preview-start">Open home screen</Link>
        {exp && <button type="button" onClick={() => setExperience(null)} className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid="button-preview-classic">Back to classic</button>}
      </div>
      {me?.isAdmin && <LaunchSwitch />}
    </section>
  );
}

/** Four-tab layout preview: what it is, and (admins) the switch that opens it to members. */
function TripCardAdmin({ adminOnly, admin }: { adminOnly: boolean; admin: boolean }) {
  if (!admin && !adminOnly) return null;
  return (
    <section className={cn("rounded-2xl bg-card px-4 py-3", adminOnly ? "border border-dashed border-primary/60" : "border border-card-border")} data-testid="card-trip-preview">
      {adminOnly && <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Admin preview</p>}
      <p className="mt-0.5 text-sm font-semibold">Home and four tabs</p>
      <p className="text-xs text-muted-foreground">Home, Briefs, Spots and Crew on every page. Home walks you through the trip: plan, find spots, add spots, rate. AI picks you keep in a saved brief become AI-added listings.{adminOnly ? " Members don't see any of this yet." : ""}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/home" className="inline-flex h-9 items-center rounded-full taxi-sign px-3.5 text-xs font-semibold hover-elevate" data-testid="link-trip-preview-home">Open Home</Link>
      </div>
      {admin && <TripSwitch />}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Private messages</p><DmSwitch /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">FBOs on trip sheets and Crew Up</p><FboCardsSwitch /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rank mascots and one-liners</p><SimpleAudienceSwitch api="/api/admin/rank-art" testId="rank-art" onText="On: members see the pelican mascot and a one-line role for each rank." offText="Off: only admins see the rank mascots." confirmOn="Show the rank mascots and one-liners to all members?" confirmOff="Hide the rank mascots from members?" /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Crews' Choice voting</p><SimpleAudienceSwitch api="/api/admin/crews-choice" testId="crews-choice" onText="On: members can vote one place to eat per field each month." offText="Off: only admins can vote and see results." confirmOn="Open Crews' Choice voting to all members?" confirmOff="Hide Crews' Choice from members? Votes are kept." extra={(d) => `${d.votes} vote${d.votes === 1 ? "" : "s"} from ${d.people} crew this month.`} /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rental cars</p><SimpleAudienceSwitch api="/api/admin/rental-cars" testId="rental-cars" onText="On: members can browse and add rental cars (the Cars type)." offText="Off: only admins see and add rental cars." confirmOn="Open rental cars to all members?" confirmOff="Hide rental cars from members? Car listings are kept." extra={(d) => `${d.votes} car listing${d.votes === 1 ? "" : "s"} live.`} /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ramp check reports</p><SimpleAudienceSwitch api="/api/admin/ramp-checks" testId="ramp-checks" onText="On: members see and post ramp check reports on FBO intel." offText="Off: only admins see and post ramp check reports." confirmOn="Open ramp check reports to all members?" confirmOff="Hide ramp check reports from members? Reports are kept." extra={(d) => `${d.votes} report${d.votes === 1 ? "" : "s"} in the last 30 days.`} /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Layover tools</p><SimpleAudienceSwitch api="/api/admin/layover-tools" testId="layover-tools" onText="On: members see the crew hotel sheet and shuttle call, 10-day forecast and TAF, abroad card, and FAA delay alerts." offText="Off: only admins see the hotel sheet, forecast, abroad card and delay alerts." confirmOn="Open layover tools to all members?" confirmOff="Hide layover tools from members? Hotel details are kept." extra={(d) => `${d.votes} hotel${d.votes === 1 ? "" : "s"} with crew details.`} /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Crew network</p><SimpleAudienceSwitch api="/api/admin/crew-network" testId="crew-network" onText="On: members get overlap alerts with My Crew, trip crew chat and the family link." offText="Off: only admins see overlaps, trip crew chat and the family link. Family links of members stop working." confirmOn="Open crew network to all members?" confirmOff="Hide crew network from members? Members' family links stop working." extra={(d) => `${d.votes} member${d.votes === 1 ? "" : "s"} using overlaps or a family link.`} /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Schedule tools</p><SimpleAudienceSwitch api="/api/admin/schedule-tools" testId="schedule-tools" onText="On: members can import trips (paste or calendar file), add trip sheets to their calendar with alarms, keep trip sheets offline, and use the duty and rest calculator." offText="Off: only admins see trip import, calendar alarms, offline trip sheets and the duty calculator." confirmOn="Open schedule tools to all members?" confirmOff="Hide schedule tools from members? Offline copies on their devices are removed next time they open the app." /></>}
      {admin && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Earlier switch: My Crew, Crew Up, Lounge</p><LaunchSwitch /></>}
    </section>
  );
}

/** Admins: open the four tabs, Home and AI-added listings to members (app_settings trip_audience). Instant, no deploy. */
function TripSwitch() {
  const { toast } = useToast();
  const q = useQuery<{ audience: "admins" | "members"; aiSpots: number; aiRated: number }>({ queryKey: ["/api/admin/trip"], queryFn: async () => (await apiRequest("GET", "/api/admin/trip")).json(), retry: false });
  const m = useMutation({
    mutationFn: async (audience: "admins" | "members") => (await apiRequest("PUT", "/api/admin/trip", { audience })).json(),
    onSuccess: (r: { audience: string }) => {
      for (const k of ["/api/admin/trip", "/api/features", "/api/search", "/api/preview/trip"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: r.audience === "members" ? "Open to members" : "Back to admins only", description: r.audience === "members" ? "Members get Home, the four tabs and AI-added listings." : "Members get the current navigation again. AI-added listings are hidden from them; nothing is deleted." });
    },
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });
  if (!q.data) return null;
  const live = q.data.audience === "members";
  return (
    <div className="mt-3 flex items-start justify-between gap-3 border-t border-dashed border-border pt-3" data-testid="row-trip-switch">
      <span><span className="block text-xs font-semibold">Open to members</span><span className="block text-[11px] text-muted-foreground">{live ? "On: members have Home, four tabs and AI-added listings." : "Off: only admins see it."} {q.data.aiSpots} AI-added listing{q.data.aiSpots === 1 ? "" : "s"}, {q.data.aiRated} rated by crew.</span></span>
      <Switch checked={live} disabled={m.isPending} onCheckedChange={(v) => { if (window.confirm(v ? "Open Home, the four tabs and AI-added listings to all members?" : "Put members back on the current navigation and hide AI-added listings from them?")) m.mutate(v ? "members" : "admins"); }} data-testid="switch-trip" aria-label="Open the four tabs to members" />
    </div>
  );
}

/** Admins: a plain admins/members switch for a preview feature (rank mascots, Crews' Choice). Instant, no deploy. */
function SimpleAudienceSwitch({ api, testId, onText, offText, confirmOn, confirmOff, extra }: { api: string; testId: string; onText: string; offText: string; confirmOn: string; confirmOff: string; extra?: (d: { votes: number; people: number }) => string }) {
  const { toast } = useToast();
  const q = useQuery<{ audience: "admins" | "members"; votes: number; people: number }>({ queryKey: [api], queryFn: async () => (await apiRequest("GET", api)).json(), retry: false });
  const m = useMutation({
    mutationFn: async (audience: "admins" | "members") => (await apiRequest("PUT", api, { audience })).json(),
    onSuccess: (r: { audience: string }) => {
      for (const k of [api, "/api/features"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: r.audience === "members" ? "Open to members" : "Back to admins only" });
    },
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });
  if (!q.data) return null;
  const live = q.data.audience === "members";
  return (
    <div className="mt-1 flex items-start justify-between gap-3 pt-1" data-testid={`row-${testId}-switch`}>
      <span><span className="block text-xs font-semibold">Open to members</span><span className="block text-[11px] text-muted-foreground">{live ? onText : offText}{extra ? ` ${extra(q.data)}` : ""}</span></span>
      <Switch checked={live} disabled={m.isPending} onCheckedChange={(v) => { if (window.confirm(v ? confirmOn : confirmOff)) m.mutate(v ? "members" : "admins"); }} data-testid={`switch-${testId}`} aria-label={`Open ${testId} to members`} />
    </div>
  );
}

/** Admins: show participating FBOs (live portal accounts) on members' trip sheets and Crew Up plans (app_settings fbo_cards_audience). */
function FboCardsSwitch() {
  const { toast } = useToast();
  const q = useQuery<{ audience: "admins" | "members"; fbos: number; airports: number }>({ queryKey: ["/api/admin/fbo-cards"], queryFn: async () => (await apiRequest("GET", "/api/admin/fbo-cards")).json(), retry: false });
  const m = useMutation({
    mutationFn: async (audience: "admins" | "members") => (await apiRequest("PUT", "/api/admin/fbo-cards", { audience })).json(),
    onSuccess: (r: { audience: string }) => {
      for (const k of ["/api/admin/fbo-cards", "/api/fbos-at", "/api/briefings"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: r.audience === "members" ? "FBO cards open to members" : "FBO cards back to admins only", description: r.audience === "members" ? "Members see participating FBOs on trip sheets and Crew Up." : "Only admins see FBO cards." });
    },
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });
  if (!q.data) return null;
  const live = q.data.audience === "members";
  return (
    <div className="mt-1 flex items-start justify-between gap-3 pt-1" data-testid="row-fbo-cards-switch">
      <span><span className="block text-xs font-semibold">Open to members</span><span className="block text-[11px] text-muted-foreground">{live ? "On: members see FBO cards." : "Off: only admins see FBO cards."} {q.data.fbos} live FBO{q.data.fbos === 1 ? "" : "s"} at {q.data.airports} airport{q.data.airports === 1 ? "" : "s"}.</span></span>
      <Switch checked={live} disabled={m.isPending} onCheckedChange={(v) => { if (window.confirm(v ? "Show participating FBOs to all members?" : "Hide FBO cards from members?")) m.mutate(v ? "members" : "admins"); }} data-testid="switch-fbo-cards" aria-label="Show FBO cards to members" />
    </div>
  );
}

/** Admins: open private messages to members (app_settings dm_audience). Counts only: messages are end-to-end encrypted. */
function DmSwitch() {
  const { toast } = useToast();
  const q = useQuery<{ audience: "admins" | "members"; messages: number; conversations: number; people: number }>({ queryKey: ["/api/admin/dm"], queryFn: async () => (await apiRequest("GET", "/api/admin/dm")).json(), retry: false });
  const m = useMutation({
    mutationFn: async (audience: "admins" | "members") => (await apiRequest("PUT", "/api/admin/dm", { audience })).json(),
    onSuccess: (r: { audience: string }) => {
      for (const k of ["/api/admin/dm", "/api/dm/config"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: r.audience === "members" ? "Messages open to members" : "Messages back to admins only", description: r.audience === "members" ? "Members can message their crew and talk in Crew Up threads." : "Members can't open Messages. Nothing is deleted." });
    },
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });
  if (!q.data) return null;
  const live = q.data.audience === "members";
  return (
    <div className="mt-1 flex items-start justify-between gap-3 pt-1" data-testid="row-dm-switch">
      <span><span className="block text-xs font-semibold">Open to members</span><span className="block text-[11px] text-muted-foreground">{live ? "On: members can message their crew." : "Off: only admins can use Messages."} {q.data.messages} message{q.data.messages === 1 ? "" : "s"} in {q.data.conversations} conversation{q.data.conversations === 1 ? "" : "s"}, {q.data.people} people set up. End-to-end encrypted, so nobody here can read them.</span></span>
      <Switch checked={live} disabled={m.isPending} onCheckedChange={(v) => { if (window.confirm(v ? "Open private messages to all members?" : "Close Messages for members? Nothing is deleted.")) m.mutate(v ? "members" : "admins"); }} data-testid="switch-dm" aria-label="Open private messages to members" />
    </div>
  );
}

/** Admins: the one switch that opens (or closes) the new landing page and its features for members. Instant, no deploy. */
function LaunchSwitch() {
  const { toast } = useToast();
  const q = useQuery<{ audience: "admins" | "members" }>({ queryKey: ["/api/admin/launch"], queryFn: async () => (await apiRequest("GET", "/api/admin/launch")).json(), retry: false });
  const m = useMutation({
    mutationFn: async (audience: "admins" | "members") => (await apiRequest("PUT", "/api/admin/launch", { audience })).json(),
    onSuccess: (r: { audience: string }) => {
      for (const k of ["/api/admin/launch", "/api/features", "/api/lounge", "/api/preview/today"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: r.audience === "members" ? "Open to members" : "Back to admins only", description: r.audience === "members" ? "Members get the new home screen, My Crew, Crew Up and the Crew Lounge." : "Members see the classic app again. Nothing they posted is lost." });
    },
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });
  if (!q.data) return null;
  const live = q.data.audience === "members";
  return (
    <div className="mt-3 flex items-start justify-between gap-3 border-t border-dashed border-border pt-3" data-testid="row-launch-switch">
      <span><span className="block text-xs font-semibold">Open to members</span><span className="block text-[11px] text-muted-foreground">{live ? "On: members see the new home screen and its features. Turn off to put everyone back on the classic app." : "Off: only admins see it."}</span></span>
      <Switch checked={live} disabled={m.isPending} onCheckedChange={(v) => { if (window.confirm(v ? "Open the new home screen, My Crew, Crew Up and the Crew Lounge to all members?" : "Put members back on the classic app? Their crew, plans and posts are kept.")) m.mutate(v ? "members" : "admins"); }} data-testid="switch-launch" aria-label="Open to members" />
    </div>
  );
}
