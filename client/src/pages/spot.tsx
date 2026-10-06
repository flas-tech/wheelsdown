import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, MapPin, Clock, Globe, Lightbulb, User } from "lucide-react";
import type { Category, Review, SpotWithStats } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CAT_META, COST_LABELS, fmtMinutes, totalMinutes, parseTags, Stars, AdBanner, Chip } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const ROLES = ["Captain", "First Officer", "Flight Attendant", "Mechanic", "Dispatcher", "Other crew"];

export default function SpotPage() {
  const [, params] = useRoute("/spot/:id");
  const id = params?.id;
  const { data, isLoading, isError } = useQuery<{ spot: SpotWithStats; reviews: Review[] }>({ queryKey: ["/api/spots", id] });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">This spot isn't available. <Link href="/" className="text-primary underline">Back to search</Link></p>;

  const { spot, reviews } = data;
  const M = CAT_META[spot.category as Category];
  const tags = parseTags(spot.tags);
  const dist = Object.fromEntries([5, 4, 3, 2, 1].map((n) => [n, reviews.filter((r) => r.rating === n).length]));

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
        <h1 className="mt-2 text-xl font-semibold leading-tight" data-testid="text-spot-name">{spot.name}</h1>
        <div className="mt-2 flex items-center gap-2">
          <Stars value={spot.avgRating ?? 0} size={16} />
          <span className="text-sm text-muted-foreground tabular" data-testid="text-rating">
            {spot.reviewCount ? `${spot.avgRating?.toFixed(1)} from ${spot.reviewCount} crew` : "No ratings yet"}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Fact label="Cost" value={COST_LABELS[spot.costLevel]} mono />
        <Fact label={spot.category === "stay" ? "Typical stay" : "Time needed"} value={fmtMinutes(spot.category === "stay" || spot.category === "fbo" ? spot.minutesNeeded : totalMinutes(spot))} />
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
          <p className="flex items-center gap-2"><Clock className="h-4 w-4" />Time estimate includes ~2 min/mile each way from the field</p>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">{tags.map((t) => <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs">{t}</span>)}</div>
        )}
        <p className="text-xs text-muted-foreground">Added by {spot.submittedBy || "crew"}</p>
      </section>

      <AdBanner slot="inline" icaos={[spot.icao]} />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-card-border bg-card p-4">
          <div>
            <h2 className="text-base font-semibold">Crew reviews</h2>
            <p className="font-code text-2xl font-bold tabular mt-1">{spot.avgRating ? spot.avgRating.toFixed(1) : "–"}<span className="text-sm text-muted-foreground font-normal"> / 5</span></p>
          </div>
          <div className="w-40 space-y-1">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-2 tabular">{n}</span>
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${reviews.length ? (dist[n] / reviews.length) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <ReviewForm spotId={spot.id} />
        {reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet — be the first.</p>}
        {reviews.map((r) => (
          <article key={r.id} className="rounded-2xl border border-card-border bg-card p-4" data-testid={`review-${r.id}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-muted"><User className="h-3.5 w-3.5" /></span>
                <span className="font-medium">{r.author}</span>
                <span className="text-xs text-muted-foreground">{r.crewRole}</span>
              </div>
              <Stars value={r.rating} size={12} />
            </div>
            {r.comment && <p className="mt-2 text-sm leading-relaxed">{r.comment}</p>}
            <p className="mt-1.5 text-[11px] text-muted-foreground">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-card-border bg-card px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={mono ? "font-code text-base font-bold text-primary" : "text-sm font-semibold"}>{value}</p>
    </div>
  );
}

function ReviewForm({ spotId }: { spotId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [author, setAuthor] = useState("");
  const [role, setRole] = useState("Captain");
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/spots/${spotId}/reviews`, { rating, comment, author: author || "Anonymous crew", crewRole: role })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/spots", String(spotId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/search"] });
      toast({ title: "Thanks — review posted" });
      setOpen(false); setRating(0); setComment("");
    },
    onError: (e: Error) => toast({ title: "Couldn't post review", description: e.message, variant: "destructive" }),
  });

  if (!open)
    return (
      <button onClick={() => setOpen(true)} data-testid="button-open-review" className="w-full rounded-2xl border border-dashed border-primary/50 px-4 py-3 text-left hover-elevate">
        <p className="text-sm font-semibold">Been here? Rate it for the next crew</p>
        <div className="mt-1"><Stars value={0} size={18} /></div>
      </button>
    );

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (rating) m.mutate(); }}
      className="rounded-2xl border border-primary/50 bg-card p-4 space-y-3"
      data-testid="form-review"
    >
      <div>
        <p className="text-xs text-muted-foreground mb-1">Your rating</p>
        <Stars value={rating} size={26} onChange={setRating} />
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="How was it? Wait times, crew discounts, anything the next crew should know…"
        rows={3}
        data-testid="input-review-comment"
        className="w-full rounded-xl border border-input bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Name or handle (optional)" data-testid="input-review-author" className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {ROLES.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)} testId={`chip-role-${r}`} className="text-xs">{r}</Chip>)}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!rating || m.isPending} data-testid="button-submit-review" className="flex-1 h-10 rounded-full taxi-sign text-sm font-semibold disabled:opacity-50 hover-elevate">
          {m.isPending ? "Posting…" : rating ? "Post review" : "Pick a rating"}
        </button>
        <button type="button" onClick={() => setOpen(false)} data-testid="button-cancel-review" className="h-10 px-4 rounded-full border border-border text-sm hover-elevate">Cancel</button>
      </div>
    </form>
  );
}
