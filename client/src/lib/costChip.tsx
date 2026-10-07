import { COST_LABELS, costRange, costExample } from "@shared/cost";
import { cn } from "@/lib/utils";

/** Price choice with its dollar range, e.g. "$$" over "$15–30 · Casual". */
export function CostChoice({ category, level, active, onClick, testId, compact }: { category: string; level: number; active: boolean; onClick: () => void; testId?: string; compact?: boolean }) {
  const range = level === 0 ? "" : costRange(category, level);
  const ex = costExample(category, level);
  return (
    <button type="button" onClick={onClick} aria-pressed={active} data-testid={testId} title={[range, ex].filter(Boolean).join(" · ")}
      className={cn("shrink-0 rounded-xl border text-left hover-elevate", compact ? "px-2.5 py-1" : "px-3 py-1.5",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>
      <span className="block font-code text-sm font-bold leading-tight">{COST_LABELS[level]}</span>
      {(range || (!compact && ex)) && (
        <span className={cn("block text-[10px] leading-tight whitespace-nowrap", active ? "opacity-90" : "text-muted-foreground")}>
          {range}{!compact && ex && level !== 0 ? <span className="hidden min-[400px]:inline"> · {ex}</span> : null}
        </span>
      )}
    </button>
  );
}
