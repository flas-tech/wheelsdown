import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Copy, MapPin } from "lucide-react";
import { costOptions, costUnit, hasCost } from "@shared/cost";
import { POINTS } from "@shared/tiers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CostChoice } from "@/lib/costChip";
import { GoAroundIcon, Stars } from "@/lib/ui";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type SimilarSpot = { id: number; name: string; category: string; address: string; reviewCount: number; avgRating: number | null; mine: boolean; score: number };

/** Listings at this airport that look like the one being typed (debounced, quiet on errors). */
export function useSimilar(code: string, name: string, place: { lat: number; lng: number; ref?: string } | null, off: boolean) {
  const [hits, setHits] = useState<SimilarSpot[]>([]);
  useEffect(() => {
    if (off || code.length < 3 || name.trim().length < 3) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ icao: code, name: name.trim() });
        if (place) { q.set("lat", String(place.lat)); q.set("lng", String(place.lng)); if (place.ref) q.set("placeRef", place.ref); }
        const r = await (await apiRequest("GET", `/api/spots/similar?${q}`)).json();
        if (live) setHits(Array.isArray(r) ? r : []);
      } catch { if (live) setHits([]); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [code, name, place?.lat, place?.lng, place?.ref, off]);
  return hits;
}

const ratingText = (s: SimilarSpot) => s.reviewCount ? `${s.avgRating != null ? s.avgRating.toFixed(1) : "0.0"} stars · ${s.reviewCount} rating${s.reviewCount === 1 ? "" : "s"}` : "No ratings yet";

/** "Is this the same place?" card shown under the Name field. */
export function DuplicatePrompt({ match, others, code, onSame, onDifferent, onPick }: {
  match: SimilarSpot; others: SimilarSpot[]; code: string; onSame: () => void; onDifferent: () => void; onPick: (s: SimilarSpot) => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-primary/50 bg-primary/5 p-3" role="alert" data-testid="panel-duplicate">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Copy className="h-4 w-4 text-primary" />Already listed at {code}?</p>
      <Link href={`/spot/${match.id}`} className="mt-2 block rounded-lg border border-border bg-card p-2.5 hover-elevate" data-testid={`link-duplicate-${match.id}`}>
        <span className="block text-sm font-semibold">{match.name}</span>
        <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
          {match.address && <><MapPin className="mt-0.5 h-3 w-3 shrink-0" /><span className="truncate">{match.address}</span><span aria-hidden>·</span></>}
          <span className="shrink-0">{ratingText(match)}</span>
        </span>
      </Link>
      {others.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">Or: {others.map((o, i) => (
          <span key={o.id}>{i > 0 && ", "}<button type="button" onClick={() => onPick(o)} className="underline hover:text-foreground" data-testid={`button-duplicate-alt-${o.id}`}>{o.name}</button></span>
        ))}</p>
      )}
      {match.mine ? (
        <div className="mt-2.5 space-y-2">
          <p className="text-xs text-muted-foreground" data-testid="text-duplicate-mine">You've already rated this place. You can update your rating on the listing.</p>
          <div className="flex gap-2">
            <Link href={`/spot/${match.id}`} className="inline-flex h-10 flex-1 items-center justify-center rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="link-duplicate-open">Open it</Link>
            <button type="button" onClick={onDifferent} className="h-10 rounded-full border border-border px-4 text-sm hover-elevate" data-testid="button-duplicate-different">It's a different place</button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2.5 text-xs text-muted-foreground">If it's the same place, add your rating and comments to it instead. Crews see everything in one place and you still earn points.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onSame} className="h-10 flex-1 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-duplicate-same">Same place, rate it</button>
            <button type="button" onClick={onDifferent} className="h-10 rounded-full border border-border px-4 text-sm hover-elevate" data-testid="button-duplicate-different">Different place</button>
          </div>
        </>
      )}
    </div>
  );
}

const LABELS = ["Go around: crews should avoid this place", "Skip it", "Meh", "Decent", "Good", "Great"];

/** Replaces the rest of the Add form: what they'd written becomes a rating and comment on the existing listing. */
export function RateInstead({ match, initial, onBack }: { match: SimilarSpot; initial: { rating: number | null; comment: string; costLevel: number | null }; onBack: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { requireAuth } = useAuth();
  const [rating, setRating] = useState<number | null>(initial.rating);
  const [comment, setComment] = useState(initial.comment);
  const [paid, setPaid] = useState<number | null>(initial.costLevel != null && costOptions(match.category).includes(initial.costLevel) ? initial.costLevel : null);
  const goAround = rating === 0;
  const needWhy = goAround && comment.trim().length < 10;
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/spots/${match.id}/reviews`, { rating, comment, costLevel: paid })).json(),
    onSuccess: (r: { modState?: string }) => {
      for (const k of ["/api/spots", "/api/search", "/api/me", "/api/crew", "/api/leaderboard", "/api/highlights", "/api/me/favorites"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: `Rating added to ${match.name}`, description: r?.modState === "checking" ? "It posts after a quick automatic check, usually under a minute." : "Thanks for keeping the listings tidy." });
      navigate(`/spot/${match.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't post your rating", description: e.message.replace(/^\d+: /, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });
  const submit = () => { if (rating != null && !needWhy) requireAuth(() => m.mutate(), `Sign in to rate this spot and earn ${POINTS.review}+ points.`); };

  return (
    <section className={cn("space-y-4 rounded-2xl border bg-card p-4", goAround ? "border-orange-500/60" : "border-primary/60")} data-testid="panel-rate-instead">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rating instead of a new listing</p>
        <p className="mt-0.5 text-base font-semibold">{match.name}</p>
        <p className="text-xs text-muted-foreground">{ratingText(match)}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-xs", goAround ? "font-medium text-orange-700 dark:text-orange-300" : "text-muted-foreground")} data-testid="text-instead-label">{rating != null ? LABELS[rating] : `Tap a star · +${POINTS.review} pts`}</p>
        <Stars value={rating ?? 0} size={30} onChange={setRating} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <p className="text-[11px] text-muted-foreground">Somewhere crews should avoid?</p>
        <button type="button" onClick={() => setRating(0)} aria-pressed={goAround} data-testid="button-instead-go-around"
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold hover-elevate", goAround ? "border-orange-500 bg-orange-500 text-white" : "border-orange-500/50 text-orange-700 dark:text-orange-300")}>
          <GoAroundIcon className="h-4 w-4" /> Go around
        </button>
      </div>
      {hasCost(match.category) && (
        <div>
          <p className="mb-1.5 text-xs font-medium">What did it cost? <span className="font-normal text-muted-foreground">optional · {costUnit(match.category)}</span></p>
          <div className="flex flex-wrap gap-1.5">
            {costOptions(match.category).map((i) => <CostChoice key={i} category={match.category} level={i} compact active={paid === i} onClick={() => setPaid(paid === i ? null : i)} testId={`chip-instead-cost-${i}`} />)}
          </div>
        </div>
      )}
      <div>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={2000} data-testid="input-instead-comment"
          placeholder={goAround ? "Why should crews go around? (required)" : "Your comment (optional): what to order, wait times, crew discounts"}
          className="w-full rounded-xl border border-input bg-background p-3 text-base focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm" />
        {initial.comment && <p className="mt-1 text-[11px] text-muted-foreground">We moved what you'd written into your comment. Edit it as you like.</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={rating == null || needWhy || m.isPending} data-testid="button-instead-submit"
          className="h-11 flex-1 rounded-full taxi-sign text-sm font-semibold hover-elevate disabled:opacity-50">
          {m.isPending ? "Posting…" : rating == null ? "Pick a rating" : needWhy ? "Add a reason to go around" : `Post rating to ${match.name.length > 22 ? "listing" : match.name}`}
        </button>
      </div>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="button-instead-back">
        <ArrowLeft className="h-4 w-4" /> No, it's a different place. Back to the new listing
      </button>
    </section>
  );
}
