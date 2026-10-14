// "Did you go?" reminders. When someone opens directions, a website or a phone number for a place, or checks in
// there, we remember it on this device. A few hours later the home screen asks them to rate it (crew listing) or add
// it for crews (AI pick). Rating, adding or "Didn't go" clears the reminder. Nothing is sent to the server.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Star, X, Plus, Sparkles } from "lucide-react";
import { POINTS } from "@shared/tiers";
import { cn } from "@/lib/utils";

const KEY = "wheelsdown-visits";
const EVENT = "wheelsdown:visits";
/** Wait this long before asking (so it lands after the meal, not while they're on the way). */
export const VISIT_DELAY = 2 * 60 * 60_000;
const KEEP = 10 * 24 * 60 * 60_000;

/** id: a crew listing id, or a negative id for an AI pick (same convention as AI cards). */
export type Visit = { id: number; name: string; icao: string; at: number; href?: string; done?: boolean };

const read = (): Visit[] => { try { return (JSON.parse(localStorage.getItem(KEY) || "[]") as Visit[]).filter((v) => v && typeof v.id === "number" && Date.now() - v.at < KEEP); } catch { return []; } };
const write = (list: Visit[]) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-10))); } catch { /* ignore */ } window.dispatchEvent(new Event(EVENT)); };

/** Remember that someone is headed to a place. A repeat visit restarts the clock; one already handled stays handled. */
export function noteVisit(v: Omit<Visit, "at">) {
  const list = read();
  const old = list.find((x) => x.id === v.id);
  if (old?.done) return;
  write([...list.filter((x) => x.id !== v.id), { ...old, ...v, at: Date.now() }]);
}
/** Rated, added or dismissed: don't ask again. */
export function clearVisit(id: number) {
  const list = read();
  if (!list.some((x) => x.id === id)) return;
  write(list.map((x) => (x.id === id ? { ...x, done: true } : x)));
}

/** Home screen card, one place at a time, newest first. */
export function VisitReminder() {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(EVENT, on);
    const t = setInterval(on, 5 * 60_000);
    return () => { window.removeEventListener(EVENT, on); clearInterval(t); };
  }, []);
  const due = read().filter((v) => !v.done && Date.now() - v.at >= VISIT_DELAY).sort((a, b) => b.at - a.at);
  if (!due.length) return null;
  const v = due[0];
  const ai = v.id < 0;
  const href = ai ? v.href || `/add/${v.icao || ""}?name=${encodeURIComponent(v.name)}&ai=${-v.id}` : `/spot/${v.id}?rate=1`;
  return (
    <section className="rounded-2xl border border-primary/40 bg-primary/5 p-3.5" data-testid="card-visit-reminder">
      <div className="flex items-start gap-3">
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", ai ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-primary/20 text-foreground")}>
          {ai ? <Sparkles className="h-4 w-4" /> : <Star className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{`Been there?${v.icao ? ` · ${v.icao}` : ""}${due.length > 1 ? ` · 1 of ${due.length}` : ""}`}</p>
          <p className="mt-0.5 text-sm font-semibold leading-snug" data-testid="text-visit-name">How was {v.name}?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{ai ? `It's an AI pick. Add it for crews and rate it: the first crew member earns +10 on top.` : `Rate it so the next crew knows. +${POINTS.review} pts, more with a comment.`}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Link href={href} onClick={() => clearVisit(v.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full taxi-sign px-3.5 text-xs font-semibold hover-elevate" data-testid="button-visit-rate">
              {ai ? <><Plus className="h-3.5 w-3.5" />Add and rate</> : <><Star className="h-3.5 w-3.5" />Rate it</>}
            </Link>
            <button type="button" onClick={() => clearVisit(v.id)} className="h-9 rounded-full border border-border px-3.5 text-xs font-medium hover-elevate" data-testid="button-visit-skip">Didn't go</button>
          </div>
        </div>
        <button type="button" onClick={() => clearVisit(v.id)} aria-label="Dismiss" className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground" data-testid="button-visit-dismiss"><X className="h-4 w-4" /></button>
      </div>
    </section>
  );
}
