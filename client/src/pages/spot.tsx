import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, MapPin, Clock, Globe, Lightbulb, User, AlertTriangle, Pencil } from "lucide-react";
import { DOWN_REASONS, type Category, type ReviewWithVotes, type SpotWithStats } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CAT_META, fmtMinutes, totalMinutes, parseTags, Stars, AdBanner, Chip, VetBadge, VoteButtons, timeAgo, GoAroundBadge, GoAroundIcon } from "@/lib/ui";
import { FavoriteButton } from "@/lib/favorites";
import { COST_LABELS, costOptions, costRange, costUnit, hasCost, paceLabel, paceOf } from "@shared/cost";
import { CostChoice } from "@/lib/costChip";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth, useCrewIndex, TierChip } from "@/lib/auth";
import { POINTS, publicName } from "@shared/tiers";


export default function SpotPage() {
  const [, params] = useRoute("/spot/:id");
  const id = params?.id;
  const crew = useCrewIndex();
  const { me } = useAuth();
  const [editing, setEditing] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery<{ spot: SpotWithStats; reviews: ReviewWithVotes[] }>({ queryKey: ["/api/spots", id] });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">This spot isn't available. <Link href="/" className="text-primary underline">Back to search</Link></p>;

  const { spot, reviews } = data;
  const M = CAT_META[spot.category as Category];
  const tags = parseTags(spot.tags);
  const dist = Object.fromEntries([5, 4, 3, 2, 1, 0].map((n) => [n, reviews.filter((r) => r.rating === n).length]));
  const mine = !!me && spot.userId === me.id;

  return (
    <div className="space-y-5">
      <Link href="/" data-testid="link-back" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Results
      </Link>

      <header>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-code font-bold rounded-md taxi-sign px-1.5 py-0.5">{spot.icao}</span>
          <span className="text-muted-foreground">{spot.airport?.city}{spot.airport?.region ? `, ${spot.airport.region}` : ""}</span>
          <span className="text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground"><M.icon className="h-3.5 w-3.5" />{M.label}</span>
        </div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold leading-tight" data-testid="text-spot-name">{spot.name}</h1>
          <FavoriteButton spotId={spot.id} name={spot.name} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Stars value={spot.avgRating ?? 0} size={16} />
          <span className="text-sm text-muted-foreground tabular" data-testid="text-rating">
            {spot.reviewCount ? `${spot.avgRating?.toFixed(1)} from ${spot.reviewCount} crew` : "No ratings yet"}
          </span>
          {spot.goArounds > 0 && <GoAroundBadge count={spot.goArounds} />}
        </div>
        {mine && (
          <Link href={`/spot/${spot.id}/edit`} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 h-8 text-xs font-medium hover-elevate" data-testid="link-edit-spot">
            <Pencil className="h-3.5 w-3.5" /> Edit your listing
          </Link>
        )}
      </header>

      <ReviewForm spotId={spot.id} category={spot.category} />

      <CrewVote spot={spot} />

      <div className={cn("grid gap-2", spot.category === "do" || spot.category === "eat" ? "grid-cols-3" : hasCost(spot.category) ? "grid-cols-2" : "grid-cols-1")}>
        {hasCost(spot.category) && (
          <Fact label={spot.costVotes > 1 ? `Crew price · ${spot.costVotes} crew` : "Price"} value={spot.cost == null ? "Not priced" : COST_LABELS[spot.cost]} mono={spot.cost != null} testId="text-spot-cost"
            sub={spot.cost != null && spot.cost > 0 ? `${costRange(spot.category, spot.cost)} ${spot.category === "stay" ? "/ night" : "pp"}` : undefined} />
        )}
        {spot.category === "eat" && <Fact label="Pace" value={paceLabel(paceOf(spot))} testId="text-spot-pace" />}
        {spot.category === "do" && <Fact label="Time needed" value={fmtMinutes(totalMinutes(spot))} />}
        <Fact label="From field" value={spot.milesFromField ? `${spot.milesFromField} mi` : "On field"} />
      </div>

      <section className="rounded-2xl border border-card-border bg-card p-4 space-y-3">
        <p className="text-sm leading-relaxed">{spot.description || "No description yet."}</p>
        {spot.crewTip && (
          <div className="flex gap-2.5 rounded-xl bg-primary/10 p-3 text-sm">
            <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <p><span className="font-semibold">Crew tip: </span>{spot.crewTip}</p>
          </div>
        )}
        <div className="space-y-1.5 text-sm text-muted-foreground">
          {spot.address && <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />
            <a className="hover:text-foreground underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://maps.apple.com/?q=${encodeURIComponent(spot.name + " " + spot.address)}`} data-testid="link-map">{spot.address}</a></p>}
          {spot.website && <p className="flex items-center gap-2"><Globe className="h-4 w-4" /><a className="hover:text-foreground hover:underline" target="_blank" rel="noopener noreferrer" href={spot.website} data-testid="link-website">Website</a></p>}
          {spot.category === "do" && <p className="flex items-center gap-2"><Clock className="h-4 w-4" />Time estimate includes ~2 min/mile each way from the field</p>}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">{tags.map((t) => <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">{t}</span>)}</div>
        )}
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">Added by {spot.userId && crew.get(spot.userId) && !crew.get(spot.userId)!.anonymous
            ? <Link href={`/crew/${spot.userId}`} className="underline-offset-2 hover:underline text-foreground" data-testid="link-spot-author">{spot.submittedBy}</Link> : (spot.submittedBy || "crew")}
          {spot.userId && crew.get(spot.userId) && <TierChip tierId={crew.get(spot.userId)!.tierId} />}</p>
      </section>

      <AdBanner slot="inline" icaos={[spot.icao]} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-card-border bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">Crew reviews</h2>
            <p className="font-code text-2xl font-bold tabular mt-1">{spot.avgRating ? spot.avgRating.toFixed(1) : "–"}<span className="text-sm text-muted-foreground font-normal"> / 5</span></p>
          </div>
          <div className="w-40 space-y-1">
            {[5, 4, 3, 2, 1, 0].map((n) => (
              <div key={n} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-3 tabular" title={n === 0 ? "Go around" : undefined}>{n === 0 ? <GoAroundIcon className="h-3 w-3 text-orange-600 dark:text-orange-400" /> : n}</span>
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div className={cn("h-full", n === 0 ? "bg-orange-500" : "bg-primary")} style={{ width: `${reviews.length ? (dist[n] / reviews.length) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        {reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet. Be the first: tap the stars at the top of the page.</p>}
        {[...reviews].sort((a, b) => (b.up - b.down) - (a.up - a.down) || b.createdAt - a.createdAt).map((r) => (
          editing === r.id ? <ReviewForm key={r.id} spotId={spot.id} category={spot.category} edit={r} onDone={() => setEditing(null)} /> :
          <article key={r.id} className="rounded-2xl border border-card-border bg-card p-4" data-testid={`review-${r.id}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-muted"><User className="h-3.5 w-3.5" /></span>
                {r.authorId ? <Link href={`/crew/${r.authorId}`} className="font-medium hover:underline underline-offset-2" data-testid={`link-review-author-${r.id}`}>{r.author}</Link> : <span className="font-medium">{r.author}</span>}
                {r.userId && crew.get(r.userId) ? <TierChip tierId={crew.get(r.userId)!.tierId} /> : <span className="text-xs text-muted-foreground">{r.crewRole}</span>}
              </div>
              <span className="flex items-center gap-2">
                {r.costLevel != null && hasCost(spot.category) && <span className="font-code text-xs font-bold text-primary" title={`Price this crew member paid: ${costRange(spot.category, r.costLevel) || "Free"}`}>{COST_LABELS[r.costLevel]}</span>}
                {r.rating === 0 ? <GoAroundBadge /> : <Stars value={r.rating} size={12} />}
              </span>
            </div>
            {r.comment && <p className="mt-2 text-sm leading-relaxed">{r.comment}</p>}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground flex items-center gap-2">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                {me && r.userId === me.id && <button type="button" onClick={() => setEditing(r.id)} className="inline-flex items-center gap-1 text-primary font-medium" data-testid={`button-edit-review-${r.id}`}><Pencil className="h-3 w-3" />Edit</button>}</p>
              <ReviewVote review={r} spotId={spot.id} />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Fact({ label, value, mono, testId, sub }: { label: string; value: string; mono?: boolean; testId?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className={mono ? "font-code text-base font-bold text-primary" : "text-sm font-semibold"} data-testid={testId}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground truncate" data-testid={testId ? `${testId}-range` : undefined}>{sub}</p>}
    </div>
  );
}

/** New rating, or (with `edit`) the author's fix to their own rating. rating 0 = Go around. */
function ReviewForm({ spotId, category, edit, onDone }: { spotId: number; category: string; edit?: ReviewWithVotes; onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(!!edit);
  const [rating, setRating] = useState<number | null>(edit ? edit.rating : null);
  const [comment, setComment] = useState(edit?.comment || "");
  const [paid, setPaid] = useState<number | null>(edit?.costLevel ?? null);
  const { me, requireAuth } = useAuth();
  const goAround = rating === 0;
  const m = useMutation({
    mutationFn: async () => (edit
      ? await apiRequest("PATCH", `/api/reviews/${edit.id}`, { rating, comment, costLevel: paid })
      : await apiRequest("POST", `/api/spots/${spotId}/reviews`, { rating, comment, costLevel: paid })).json(),
    onSuccess: () => {
      for (const k of [["/api/spots", String(spotId)], ["/api/search"], ["/api/me"], ["/api/crew"], ["/api/leaderboard"], ["/api/highlights"], ["/api/me/favorites"]]) queryClient.invalidateQueries({ queryKey: k });
      if (edit) { toast({ title: "Rating updated" }); onDone?.(); return; }
      setOpen(false); setRating(null); setComment(""); setPaid(null);
    },
    onError: (e: Error) => toast({ title: edit ? "Couldn't update rating" : "Couldn't post review", description: e.message.replace(/^\d+: /, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });

  const LABELS = ["Go around: crews should avoid this place", "Skip it", "Meh", "Decent", "Good", "Great"];
  const pick = (n: number) => requireAuth(() => { setRating(n); setOpen(true); }, `Sign in to rate this spot and earn ${POINTS.review}+ points.`);
  const cancel = () => { if (edit) return onDone?.(); setOpen(false); setRating(null); setComment(""); setPaid(null); };
  const needWhy = goAround && comment.trim().length < 10;

  return (
    <form
      id={edit ? undefined : "rate"}
      onSubmit={(e) => { e.preventDefault(); if (rating != null && !needWhy) m.mutate(); }}
      className={cn("rounded-2xl border bg-card p-4", open ? (goAround ? "border-orange-500/60" : "border-primary/60") : "border-card-border")}
      data-testid={edit ? `form-edit-review-${edit.id}` : "form-review"}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{edit ? "Edit your rating" : open ? "Your rating" : "Been here? Rate it"}</p>
          <p className={cn("text-xs", goAround ? "text-orange-700 dark:text-orange-300 font-medium" : "text-muted-foreground")} data-testid="text-rating-label">{rating != null ? LABELS[rating] : `Tap a star · +${POINTS.review} pts`}</p>
        </div>
        <Stars value={rating ?? 0} size={30} onChange={pick} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <p className="text-[11px] text-muted-foreground">Somewhere crews should avoid?</p>
        <button type="button" onClick={() => pick(0)} aria-pressed={goAround} data-testid="button-go-around"
          className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-semibold hover-elevate",
            goAround ? "border-orange-500 bg-orange-500 text-white" : "border-orange-500/50 text-orange-700 dark:text-orange-300")}>
          <GoAroundIcon className="h-4 w-4" /> Go around
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {hasCost(category) && (
            <div data-testid="panel-review-cost">
              <p className="text-xs font-medium mb-1.5">What did it cost? <span className="text-muted-foreground font-normal">optional · {costUnit(category)}</span></p>
              <div className="flex gap-1.5 flex-wrap">
                {costOptions(category).map((i) => (
                  <CostChoice key={i} category={category} level={i} compact active={paid === i} onClick={() => setPaid(paid === i ? null : i)} testId={`chip-review-cost-${i}`} />
                ))}
              </div>
            </div>
          )}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={goAround ? "Why should crews go around? (required) Service, safety, hygiene, closed, not crew-friendly…" : "Add a comment (optional): wait times, crew discounts, anything the next crew should know"}
            rows={3}
            autoFocus
            data-testid="input-review-comment"
            className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {goAround && <p className="text-[11px] text-muted-foreground">A go-around counts as 0 stars in the average and keeps this place out of suggested trip briefings when most crews say go around.</p>}
          <p className="text-xs text-muted-foreground">Posting as <b className="text-foreground" data-testid="text-posting-as">{me ? publicName(me) : ""}</b> (<Link href="/me" className="underline">change</Link>) · +{POINTS.reviewDetail} more pts for a comment of 40+ characters</p>
          <div className="flex gap-2">
            <button type="submit" disabled={rating == null || needWhy || m.isPending} data-testid="button-submit-review" className="flex-1 h-10 rounded-full taxi-sign text-sm font-semibold disabled:opacity-50 hover-elevate">
              {m.isPending ? (edit ? "Saving…" : "Posting…") : edit ? "Save changes" : needWhy ? "Add a reason to go around" : goAround ? "Post go-around" : comment.trim() ? "Post rating & comment" : "Post rating"}
            </button>
            <button type="button" onClick={cancel} data-testid="button-cancel-review" className="h-10 px-4 rounded-full border border-border text-sm hover-elevate">Cancel</button>
          </div>
        </div>
      )}
    </form>
  );
}

function useVote(path: string, spotId: number) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (p: { value: number; reason?: string }) => (await apiRequest("POST", path, p)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/spots", String(spotId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crew"] });
    },
    onError: (e: Error) => toast({ title: "Vote didn't go through", description: e.message, variant: "destructive" }),
  });
}

function CrewVote({ spot }: { spot: SpotWithStats }) {
  const { toast } = useToast();
  const v = spot.vet;
  const m = useVote(`/api/spots/${spot.id}/vote`, spot.id);
  const [askReason, setAskReason] = useState(false);
  const total = v.up + v.down;
  const pct = total ? Math.round((v.up / total) * 100) : 0;
  const topReasons = Object.entries(v.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const label = (id: string) => DOWN_REASONS.find((r) => r.id === id)?.label || id;

  const { requireAuth } = useAuth();
  const onVote = (value: number) => requireAuth(() => {
    if (value === -1) { setAskReason(true); return; }
    setAskReason(false);
    m.mutate({ value });
  }, `Sign in to vote and earn ${POINTS.vote} point per vote.`);

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4 space-y-3" data-testid="panel-crew-vote">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Is this listing still good?</p>
          <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-vote-summary">
            {total ? <>{pct}% of {total} crew vote up{v.lastUpAt ? <> · last upvote {timeAgo(v.lastUpAt)}</> : null}</> : "No votes yet — be the first to vet it."}
          </p>
        </div>
        <VetBadge vet={v} compact />
      </div>
      {total > 0 && (
        <div className="h-1.5 w-full rounded-full bg-orange-500/30 overflow-hidden" aria-hidden>
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      <VoteButtons up={v.up} down={v.down} mine={v.myVote} onVote={onVote} testPrefix="button-vote-spot" />
      {askReason && (
        <div className="space-y-2 rounded-xl bg-muted/50 p-3" data-testid="panel-down-reason">
          <p className="text-xs font-medium">What's wrong with it?</p>
          <div className="flex flex-wrap gap-1.5">
            {DOWN_REASONS.map((r) => (
              <Chip key={r.id} className="text-xs" testId={`chip-reason-${r.id}`}
                onClick={() => { setAskReason(false); m.mutate({ value: -1, reason: r.id }, {}); }}>
                {r.label}
              </Chip>
            ))}
          </div>
          <button type="button" onClick={() => setAskReason(false)} className="text-xs text-muted-foreground hover:text-foreground" data-testid="button-cancel-reason">Cancel</button>
        </div>
      )}
      {v.level === "needs_check" && topReasons.length > 0 && (
        <div className="flex gap-2 rounded-xl bg-orange-500/10 p-3 text-xs" data-testid="text-needs-check">
          <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <p>Recent crew reports: {topReasons.map(([k, n]) => `${label(k)} (${n})`).join(", ")}. Confirm before you go.</p>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">One vote per crew account. Votes older than 12 months stop counting, so listings stay current.</p>
    </section>
  );
}

function ReviewVote({ review, spotId }: { review: ReviewWithVotes; spotId: number }) {
  const m = useVote(`/api/reviews/${review.id}/vote`, spotId);
  const { requireAuth } = useAuth();
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Helpful?</span>
      <VoteButtons size="sm" up={review.up} down={review.down} mine={review.myVote} onVote={(value) => requireAuth(() => m.mutate({ value }), "Sign in to vote on reviews.")} testPrefix={`button-vote-review-${review.id}`} />
    </div>
  );
}
