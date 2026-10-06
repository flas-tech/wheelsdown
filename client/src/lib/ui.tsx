import { useEffect, useRef, useState, createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { Utensils, Compass, BedDouble, PlaneLanding, Star, Moon, Sun } from "lucide-react";
import type { Ad, Category } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export const CAT_META: Record<Category, { label: string; prompt: string; icon: typeof Utensils; dot: string }> = {
  eat: { label: "Eat", prompt: "Something to eat", icon: Utensils, dot: "bg-amber-400" },
  do: { label: "Do", prompt: "Something to do", icon: Compass, dot: "bg-sky-400" },
  stay: { label: "Stay", prompt: "Somewhere to stay", icon: BedDouble, dot: "bg-violet-400" },
  fbo: { label: "FBO intel", prompt: "FBO commentary", icon: PlaneLanding, dot: "bg-emerald-400" },
};

export const COST_LABELS = ["Free", "$", "$$", "$$$", "$$$$"];

export function fmtMinutes(m: number) {
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = m / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hr`;
  }
  const d = m / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d > 1 ? "s" : ""}`;
}
// Rough door-to-door estimate: activity time + round trip at ~2 min/mile
export function totalMinutes(s: { minutesNeeded: number; milesFromField: number | null }) {
  return s.minutesNeeded + Math.round((s.milesFromField || 0) * 4);
}
export function parseTags(t: string): string[] {
  try {
    return JSON.parse(t);
  } catch {
    return [];
  }
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-label="Wheelsdown logo" className={className}>
      <path d="M20 5v12M15 12.5l5 5 5-5" stroke="hsl(var(--primary))" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="26" r="4" stroke="hsl(var(--primary))" strokeWidth="2.8" />
      <circle cx="26" cy="26" r="4" stroke="hsl(var(--primary))" strokeWidth="2.8" />
      <path d="M5 34h30" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="4.5 3" />
    </svg>
  );
}

export function Stars({ value, size = 14, onChange }: { value: number; size?: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = value >= i - 0.25;
        const el = (
          <Star
            style={{ width: size, height: size }}
            className={cn(filled ? "fill-primary text-primary" : "text-muted-foreground/40")}
          />
        );
        return onChange ? (
          <button key={i} type="button" aria-label={`${i} stars`} data-testid={`button-star-${i}`} onClick={() => onChange(i)} className="p-1 -m-0.5">
            {el}
          </button>
        ) : (
          <span key={i}>{el}</span>
        );
      })}
    </div>
  );
}

// ---------- Theme ----------
const ThemeCtx = createContext<{ dark: boolean; toggle: () => void }>({ dark: true, toggle: () => {} });
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(() => (typeof window !== "undefined" ? !window.matchMedia("(prefers-color-scheme: light)").matches : true));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return <ThemeCtx.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>{children}</ThemeCtx.Provider>;
}
export function ThemeToggle() {
  const { dark, toggle } = useContext(ThemeCtx);
  return (
    <button onClick={toggle} data-testid="button-theme" aria-label="Toggle theme" className="h-9 w-9 grid place-items-center rounded-full hover-elevate text-muted-foreground">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ---------- Ads ----------
const seen = new Set<number>();
export function AdBanner({ slot, icaos = [], index = 0, className }: { slot: "top" | "inline" | "footer"; icaos?: string[]; index?: number; className?: string }) {
  const key = icaos.join(",");
  const { data } = useQuery<Ad[]>({ queryKey: ["/api/ads", key], queryFn: async () => (await apiRequest("GET", `/api/ads?icaos=${key}`)).json() });
  const pool = (data || []).filter((a) => a.slot === slot);
  // Prefer airport-targeted ads when available
  const targeted = pool.filter((a) => a.targetIcao && icaos.includes(a.targetIcao));
  const list = targeted.length ? [...targeted, ...pool.filter((a) => !a.targetIcao)] : pool;
  const ad = list.length ? list[index % list.length] : undefined;
  const sent = useRef(false);
  useEffect(() => {
    if (ad && !sent.current && !seen.has(ad.id * 1000 + index)) {
      sent.current = true;
      seen.add(ad.id * 1000 + index);
      apiRequest("POST", `/api/ads/${ad.id}/impression`).catch(() => {});
    }
  }, [ad?.id]);
  if (!ad) return null;
  const onClick = () => {
    apiRequest("POST", `/api/ads/${ad.id}/click`).catch(() => {});
    if (ad.url) window.open(ad.url, "_blank", "noopener,noreferrer");
  };
  return (
    <aside
      data-testid={`ad-${slot}-${ad.id}`}
      className={cn(
        "relative rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3 flex items-center gap-3",
        className,
      )}
    >
      <span className="absolute -top-2 left-3 bg-background px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sponsored</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground truncate">{ad.advertiser}</p>
        <p className="text-sm font-semibold leading-snug">{ad.headline}</p>
        {ad.body && slot !== "footer" && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ad.body}</p>}
      </div>
      <button onClick={onClick} data-testid={`button-ad-${ad.id}`} className="shrink-0 rounded-full taxi-sign px-3 py-1.5 text-xs font-semibold hover-elevate">
        {ad.cta || "Learn more"}
      </button>
    </aside>
  );
}

export function Chip({ active, onClick, children, testId, className }: { active?: boolean; onClick?: () => void; children: React.ReactNode; testId?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover-elevate text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
