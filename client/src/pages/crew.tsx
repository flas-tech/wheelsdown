import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TIERS, type PublicUser } from "@shared/tiers";
import { useAuth, Insignia, TierChip } from "@/lib/auth";
import { Chip } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TierLadder } from "./profile";

export default function CrewPage() {
  const { me } = useAuth();
  const { data, isLoading } = useQuery<PublicUser[]>({ queryKey: ["/api/crew"] });
  const [base, setBase] = useState("");
  const bases = Array.from(new Set((data || []).map((u) => u.homeBase).filter(Boolean))).sort();
  const rows = (data || []).filter((u) => !base || u.homeBase === base);
  const albatrosses = (data || []).filter((u) => u.tierId === "ancient_albatross");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Crew leaderboard</h1>
        <p className="text-sm text-muted-foreground mt-1">The people keeping the network vetted. Points come from listings, ratings and votes.</p>
      </header>

      {albatrosses.length > 0 && (
        <section className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(135deg,#0B0F1A,#1F2937 60%,#F8D27A44)" }} data-testid="section-albatross-wall">
          <p className="font-code text-[10px] tracking-[0.25em] text-[#F8D27A]">THE ALBATROSS WALL</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {albatrosses.map((u) => (
              <div key={u.id} className="flex items-center gap-2">
                <Insignia tierId="ancient_albatross" className="h-6" />
                <div><p className="text-sm font-semibold">{u.displayName}</p><p className="text-[11px] text-white/60">{u.homeBase} · {u.points.toLocaleString()} pts</p></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {bases.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          <Chip active={!base} onClick={() => setBase("")} testId="chip-base-all">All bases</Chip>
          {bases.map((b) => <Chip key={b} active={base === b} onClick={() => setBase(b)} testId={`chip-base-${b}`} className="font-code">{b}</Chip>)}
        </div>
      )}

      <ol className="rounded-2xl border border-card-border bg-card divide-y divide-border">
        {isLoading && <li className="p-4"><Skeleton className="h-10" /></li>}
        {rows.map((u, i) => (
          <li key={u.id} className={cn("flex items-center gap-3 px-4 py-3", me?.id === u.id && "bg-primary/10")} data-testid={`row-crew-${u.handle}`}>
            <span className="w-6 font-code text-sm font-bold text-muted-foreground tabular">{i + 1}</span>
            <Insignia tierId={u.tierId} className="h-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{u.displayName}{me?.id === u.id && <span className="ml-1.5 text-[10px] uppercase text-primary">You</span>}</p>
              <p className="text-[11px] text-muted-foreground truncate">{u.crewRole}{u.homeBase ? ` · ${u.homeBase}` : ""} · {u.participation} {u.participation === 1 ? "contribution" : "contributions"}</p>
            </div>
            <div className="text-right">
              <p className="font-code text-sm font-bold tabular">{u.points.toLocaleString()}</p>
              <TierChip tierId={u.tierId} />
            </div>
          </li>
        ))}
      </ol>

      <TierLadder points={me?.points ?? 0} signedIn={!!me} />
      <p className="text-[11px] text-muted-foreground">{TIERS.length} ratings. Points are counted from your activity, so the total always matches your logbook.</p>
    </div>
  );
}
