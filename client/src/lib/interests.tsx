import { INTEREST_GROUPS, INTERESTS, MAX_INTERESTS } from "@shared/interests";
import { cn } from "@/lib/utils";

/** Read-only expertise badges, e.g. "Pizza expert". */
export function InterestChips({ ids, className, dark }: { ids: string[]; className?: string; dark?: boolean }) {
  if (!ids?.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} data-testid="interest-chips">
      {ids.filter((i) => INTERESTS[i]).map((i) => (
        <span key={i} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", dark ? "bg-white/10 text-white" : "bg-primary/15 text-foreground")} data-testid={`chip-interest-${i}`}>{INTERESTS[i]}</span>
      ))}
    </div>
  );
}

/** Pick up to MAX_INTERESTS badges. */
export function InterestPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const full = value.length >= MAX_INTERESTS;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : full ? value : [...value, id]);
  return (
    <div className="space-y-2.5" data-testid="picker-interests">
      {INTEREST_GROUPS.map((g) => (
        <div key={g.group}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {g.items.map(([id, label]) => {
              const on = value.includes(id);
              return (
                <button key={id} type="button" onClick={() => toggle(id)} aria-pressed={on} disabled={!on && full} data-testid={`button-interest-${id}`}
                  className={cn("min-h-9 rounded-full border px-3 text-[13px] font-medium transition-colors", on ? "border-primary bg-primary/15 text-foreground" : "border-input text-muted-foreground hover:text-foreground", !on && full && "opacity-40")}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">{value.length} of {MAX_INTERESTS} picked</p>
    </div>
  );
}
