import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const inputCls = "w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
export const areaCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
export const btn = "inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3 text-sm font-medium border border-border bg-card hover-elevate disabled:opacity-50 whitespace-nowrap";
export const btnPrimary = "inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3.5 text-sm font-semibold taxi-sign hover-elevate disabled:opacity-50 whitespace-nowrap";
export const btnGhost = "inline-flex items-center justify-center gap-1.5 h-8 rounded-lg px-2 text-sm text-muted-foreground hover-elevate disabled:opacity-50";
export const btnDanger = "inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-3 text-sm font-medium border border-destructive/40 text-destructive hover-elevate disabled:opacity-50";

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

const ThemeCtx = createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} });
const THEME_KEY = "wheelsdown-fbo-theme";
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    try { const t = localStorage.getItem(THEME_KEY); if (t) return t === "dark"; } catch { /* */ }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch { /* */ } }, [dark]);
  return <ThemeCtx.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>{children}</ThemeCtx.Provider>;
}
export function ThemeToggle() {
  const { dark, toggle } = useContext(ThemeCtx);
  return (
    <button onClick={toggle} aria-label="Toggle theme" data-testid="button-theme" className="h-9 w-9 grid place-items-center rounded-full hover-elevate text-muted-foreground">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-card-border bg-card p-4", className)} {...rest}>{children}</div>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Counter({ value, max }: { value: string; max: number }) {
  return <span className={cn("tabular text-[11px]", value.length > max * 0.9 ? "text-destructive" : "text-muted-foreground")}>{value.length}/{max}</span>;
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />; }

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
export const fmtWhen = (t: number | null | undefined) => (t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
export const today = () => new Date().toLocaleDateString("en-CA");
