import { PlaneLanding, Compass, Route, Globe, Utensils, Map, BedDouble, ClipboardCheck, Star, MessageSquare, ShieldAlert, Heart, Award, ClipboardList, Users, type LucideIcon } from "lucide-react";
import { ACHIEVEMENTS, achievementById, type Achievement } from "@shared/achievements";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "plane-landing": PlaneLanding, compass: Compass, route: Route, globe: Globe, utensils: Utensils, map: Map, bed: BedDouble,
  "clipboard-check": ClipboardCheck, star: Star, "message-square": MessageSquare, "shield-alert": ShieldAlert, heart: Heart,
  award: Award, "clipboard-list": ClipboardList, users: Users,
};
const TONE = {
  bronze: "from-[#C98A4B] to-[#8A5527] text-white ring-[#C98A4B]/40",
  silver: "from-[#C9D1DB] to-[#7E8A99] text-[#18202B] ring-[#9AA5B3]/40",
  gold: "from-[#F5C518] to-[#B8860B] text-[#2A1F00] ring-[#F5C518]/40",
};

/** Round medal with the badge's icon. Locked badges are drawn flat and faded. */
export function BadgeMedal({ a, earned = true, className }: { a: Achievement; earned?: boolean; className?: string }) {
  const Icon = ICONS[a.icon] || Award;
  return (
    <span className={cn("inline-grid shrink-0 place-items-center rounded-full", earned ? `bg-gradient-to-br ring-2 ${TONE[a.tone]}` : "bg-muted text-muted-foreground/60", className || "h-10 w-10")} aria-hidden="true">
      <Icon className="h-[48%] w-[48%]" strokeWidth={2.2} />
    </span>
  );
}

/** Earned badges as a compact row, for the public crew profile. */
export function BadgeShelf({ ids }: { ids: string[] }) {
  const list = ids.map(achievementById).filter((a): a is Achievement => !!a);
  if (!list.length) return null;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="section-badges">
      <h2 className="text-sm font-semibold">Badges <span className="font-normal text-muted-foreground">· {list.length} earned</span></h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-2.5" title={a.desc} data-testid={`badge-${a.id}`}>
            <BadgeMedal a={a} className="h-9 w-9" />
            <span className="min-w-0"><span className="block text-xs font-semibold leading-tight">{a.name}</span><span className="block text-[10.5px] leading-tight text-muted-foreground">{a.desc}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every badge with progress, for the member's own Logbook. */
export function BadgeProgressGrid({ progress }: { progress: { id: string; earned: boolean; value: number; goal: number }[] }) {
  const by = new globalThis.Map(progress.map((p) => [p.id, p] as const));
  const earned = progress.filter((p) => p.earned).length;
  const ordered = [...ACHIEVEMENTS].sort((x, y) => Number(!!by.get(y.id)?.earned) - Number(!!by.get(x.id)?.earned));
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="section-my-badges">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Badges</h2>
        <span className="font-code text-xs tabular text-muted-foreground">{earned}/{ACHIEVEMENTS.length} earned</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Earned ones show on your crew profile. Badges are just for show; they don't add points.</p>
      <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {ordered.map((a) => {
          const p = by.get(a.id) || { earned: false, value: 0, goal: a.goal };
          return (
            <li key={a.id} className={cn("flex items-center gap-3 rounded-xl border p-2.5", p.earned ? "border-primary/30 bg-primary/5" : "border-border")} data-testid={`progress-${a.id}`}>
              <BadgeMedal a={a} earned={p.earned} />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-semibold leading-tight", !p.earned && "text-muted-foreground")}>{a.name}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">{a.desc}</p>
                {!p.earned && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(p.value / p.goal) * 100}%` }} /></div>
                    <span className="font-code text-[10px] tabular text-muted-foreground">{p.value}/{p.goal}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
