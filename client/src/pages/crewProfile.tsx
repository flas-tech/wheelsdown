import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, EyeOff, MessageSquare, MapPin } from "lucide-react";
import type { Review, SpotWithStats } from "@shared/schema";
import type { PublicUser } from "@shared/tiers";
import { COST_LABELS } from "@shared/cost";
import { useAuth } from "@/lib/auth";
import { Stars } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { TierCard } from "./profile";
import { SpotCard } from "./home";

type CrewProfile = {
  user: PublicUser; rank: number; hidden: boolean; counts: { listings: number; reviews: number };
  spots: SpotWithStats[]; reviews: (Omit<Review, "userId"> & { spotName: string })[];
};

export default function CrewProfilePage() {
  const [, params] = useRoute("/crew/:id");
  const { me } = useAuth();
  const { data, isLoading, isError } = useQuery<CrewProfile>({ queryKey: ["/api/crew", params?.id] });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-48 rounded-3xl" /><Skeleton className="h-24 rounded-2xl" /></div>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">This crew member isn't available. <Link href="/crew" className="text-primary underline">Back to the leaderboard</Link></p>;
  const { user: u, counts } = data;
  const isMe = me?.id === u.id;

  return (
    <div className="space-y-5">
      <Link href="/crew" data-testid="link-back-crew" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Leaderboard
      </Link>
      <TierCard points={u.points} tierId={u.tierId} name={u.displayName} sub={`${u.crewRole}${u.homeBase ? ` · ${u.homeBase}` : ""} · #${data.rank} on the leaderboard`} />
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Listings" value={counts.listings} />
        <Stat label="Ratings" value={counts.reviews} />
        <Stat label="Contributions" value={u.participation} />
      </div>
      {isMe && <p className="text-xs text-muted-foreground">This is how other crews see you. <Link href="/me" className="text-primary underline">Edit your profile</Link></p>}

      {data.hidden ? (
        <div className="rounded-2xl border border-dashed border-border p-5 text-center" data-testid="text-crew-hidden">
          <EyeOff className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">Posts are anonymous</p>
          <p className="mt-1 text-xs text-muted-foreground">This crew member posts as "Anonymous {u.crewRole.toLowerCase()}", so their listings and ratings aren't linked to their profile.</p>
        </div>
      ) : (
        <>
          <section className="space-y-2.5">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><MapPin className="h-4 w-4 text-primary" />Listings added</h2>
            {data.spots.length === 0 ? <p className="text-sm text-muted-foreground">No listings yet.</p> : data.spots.map((s) => <SpotCard key={s.id} spot={s} />)}
          </section>
          <section className="space-y-2.5">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><MessageSquare className="h-4 w-4 text-primary" />Ratings and comments</h2>
            {data.reviews.length === 0 ? <p className="text-sm text-muted-foreground">No ratings yet.</p> : data.reviews.map((r) => (
              <Link key={r.id} href={`/spot/${r.spotId}`} className="block rounded-2xl border border-card-border bg-card p-4 hover-elevate" data-testid={`crew-review-${r.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold truncate">{r.spotName}</p>
                  <span className="flex items-center gap-2 shrink-0">
                    {r.costLevel != null && <span className="font-code text-xs font-bold text-primary">{COST_LABELS[r.costLevel]}</span>}
                    <Stars value={r.rating} size={12} />
                  </span>
                </div>
                {r.comment && <p className="mt-1.5 text-sm text-muted-foreground whitespace-pre-line line-clamp-4">{r.comment}</p>}
                <p className="mt-1.5 text-[11px] text-muted-foreground">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-card-border bg-card px-2 py-2.5">
      <p className="font-code text-lg font-bold tabular">{value.toLocaleString()}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
