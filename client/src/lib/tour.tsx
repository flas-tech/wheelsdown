import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, ClipboardList, Heart, MapPin, MessageSquare, PlaneLanding, Search, Share2, Star, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { POINTS, TIERS } from "@shared/tiers";
import { Insignia } from "@/lib/auth";
import { GoAroundIcon, Logo } from "@/lib/ui";
import { cn } from "@/lib/utils";

const DONE_KEY = "wheelsdown-tour-done";
const EVENT = "wheelsdown:tour";

/** Open the tour from anywhere (Logbook link, right after sign-up). */
export function startTour() { window.dispatchEvent(new Event(EVENT)); }
/** Called once a new account is created: show the tour unless they've already seen it on this device. */
export function startTourForNewMember() {
  try { if (localStorage.getItem(DONE_KEY)) return; } catch { /* private mode: still show it */ }
  setTimeout(startTour, 700); // let the sign-in dialog close first
}

const chip = "rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85";
const Band = ({ children }: { children: React.ReactNode }) => (
  <div className="relative flex h-52 items-center justify-center overflow-hidden rounded-t-2xl bg-[#0B1222] px-6 pb-3 pt-11 text-white" aria-hidden>
    <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "18px 18px" }} />
    <div className="relative w-full max-w-[300px]">{children}</div>
  </div>
);

const STEPS: { key: string; title: string; body: string; art: React.ReactNode }[] = [
  {
    key: "welcome", title: "Welcome to Wheelsdown",
    body: "Layover picks from crews who've actually been there: where to eat, what to do, where to stay and which FBOs treat you right. Here's a one-minute tour.",
    art: <div className="flex flex-col items-center gap-3"><Logo className="h-16 w-16" /><p className="text-lg font-bold tracking-tight">Wheels<span className="text-primary">down</span></p><p className="text-xs text-white/60">Crew-vetted layover guide</p></div>,
  },
  {
    key: "search", title: "Search your whole route",
    body: "Type the airport codes for every stop, three or four letters each (OPF or KOPF). Then filter by how much time you have, the price, and Grab & go or Sit-down.",
    art: <div className="space-y-2.5">
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-[#0B1222]"><Search className="h-4 w-4 text-[#0B1222]/50" /><span className="font-code text-sm tracking-widest">KOPF KTEB KASE</span></div>
      <div className="flex flex-wrap gap-1.5"><span className={chip}>Under 1 hr</span><span className={chip}>$$</span><span className={cn(chip, "bg-primary text-[#0B1222]")}>Grab &amp; go</span><span className={chip}>Sit-down</span></div>
    </div>,
  },
  {
    key: "rate", title: "Rate it, or add what's missing",
    body: `Been somewhere? Rate it for ${POINTS.review} points, plus ${POINTS.reviewDetail} more for a real comment. Add a place crews haven't found yet for ${POINTS.listing}. If it's a place to avoid, mark it Go around.`,
    art: <div className="rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
      <p className="text-sm font-semibold">Versailles Restaurant</p>
      <div className="mt-1.5 flex items-center gap-1">{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn("h-5 w-5", i <= 4 ? "fill-primary text-primary" : "text-white/25")} />)}<span className="ml-2 text-xs text-white/60">+{POINTS.review} pts</span></div>
      <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-orange-400/60 px-2.5 py-1 text-[11px] font-semibold text-orange-300"><GoAroundIcon className="h-3.5 w-3.5" />Go around</div>
    </div>,
  },
  {
    key: "brief", title: "Favorites become trip briefings",
    body: "Tap the heart on anything you like. Build a trip briefing for your route and your favorites are always included, with a map and a printable PDF to share with the crew.",
    art: <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="rounded-xl bg-white/[0.06] p-3 text-center ring-1 ring-white/10"><Heart className="mx-auto h-7 w-7 fill-rose-500 text-rose-500" /><p className="mt-1.5 text-[11px] text-white/70">Favorites</p></div>
      <ArrowRight className="h-4 w-4 text-white/40" />
      <div className="rounded-xl bg-white p-3 text-center text-[#0B1222]"><ClipboardList className="mx-auto h-7 w-7" /><p className="mt-1.5 text-[11px] font-semibold">Map + PDF</p></div>
    </div>,
  },
  {
    key: "checkin", title: "Check in and build your map",
    body: "Check in when you're at a place. It's private and only works when your phone confirms you're there. Your Logbook keeps a map of everywhere you've added and visited.",
    art: <div className="relative mx-auto h-32 w-full rounded-xl bg-[#14213A] ring-1 ring-white/10">
      <svg viewBox="0 0 300 128" className="absolute inset-0 h-full w-full"><path d="M0 90 C60 70 90 110 150 80 S240 40 300 60" stroke="rgba(255,255,255,.12)" strokeWidth="10" fill="none" /><path d="M40 0 L70 128 M210 0 L180 128" stroke="rgba(255,255,255,.07)" strokeWidth="6" /></svg>
      {[[22, 30], [48, 62], [70, 38], [84, 70]].map(([x, y], i) => <MapPin key={i} className={cn("absolute h-6 w-6 -translate-x-1/2 -translate-y-full", i % 2 ? "text-sky-300" : "text-primary")} style={{ left: `${x}%`, top: `${y}%` }} />)}
      <div className="absolute bottom-2 left-2 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-[#0B1222]">Checked in</div>
    </div>,
  },
  {
    key: "ranks", title: "Earn points, climb the ratings",
    body: `Everything you add, rate and vote on earns points, from Student up through Private, Commercial and ATP. Share your invite link from the Logbook and get ${POINTS.referral} points each time someone signs up with it.`,
    art: <div className="space-y-1.5">
      {TIERS.filter((t) => ["private", "commercial", "atp"].includes(t.id)).map((t) => (
        <div key={t.id} className="flex items-center gap-3 rounded-lg bg-white/[0.06] px-3 py-1.5 ring-1 ring-white/10">
          <Insignia tierId={t.id} className="h-5 w-auto" /><span className="flex-1 text-sm font-semibold">{t.name}</span><span className="font-code text-xs text-white/60">{t.min.toLocaleString()} pts</span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-[11px] text-white/70"><Share2 className="h-3.5 w-3.5 text-primary" />+{POINTS.referral} pts per crew member who signs up</div>
    </div>,
  },
  {
    key: "profile", title: "Make it yours, tell us what to fix",
    body: "Finish your profile so crews know whose picks they're reading. If something's wrong or missing, tap Send feedback at the bottom of any page. It goes straight to the team.",
    art: <div className="space-y-2.5">
      <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-[#0B1222]"><UserRound className="h-5 w-5" /></div>
        <div className="flex-1"><div className="h-2 w-24 rounded bg-white/50" /><div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-white/10"><div className="h-full w-3/5 rounded bg-primary" /></div></div></div>
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#0B1222]"><MessageSquare className="h-4 w-4" />Send feedback</div>
    </div>,
  },
];

/** Mounted once in the app shell; opens on startTour(). Skippable at any step. */
export function TourHost() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [, navigate] = useLocation();
  const touch = useRef<number | null>(null);
  useEffect(() => {
    const on = () => { setI(0); setOpen(true); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const finish = (to?: string) => {
    try { localStorage.setItem(DONE_KEY, String(Date.now())); } catch { /* ignore */ }
    setOpen(false);
    if (to) navigate(to);
  };
  const last = i === STEPS.length - 1;
  const s = STEPS[i];
  const next = () => (last ? finish() : setI(i + 1));
  const back = () => setI(Math.max(0, i - 1));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) finish(); }}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl p-0 [&>button]:hidden" data-testid="dialog-tour"
        onKeyDown={(e) => { if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft") back(); }}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (dx < -50) next(); if (dx > 50) back(); }}>
        <div className="relative">
          <Band>{s.art}</Band>
          <button type="button" onClick={() => finish()} className="absolute right-3 top-3 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 hover:bg-white/20" data-testid="button-tour-skip">Skip tour</button>
        </div>
        <div className="p-5 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="text-tour-step">{i + 1} of {STEPS.length}</p>
          <DialogTitle className="mt-1 text-lg font-semibold leading-snug" data-testid="text-tour-title">{s.title}</DialogTitle>
          <DialogDescription className="mt-1.5 min-h-[88px] text-sm leading-relaxed text-muted-foreground">{s.body}</DialogDescription>
          <div className="mt-4 flex justify-center gap-1.5" role="tablist" aria-label="Tour steps">
            {STEPS.map((x, k) => <button key={x.key} type="button" role="tab" aria-selected={k === i} aria-label={`Step ${k + 1}: ${x.title}`} onClick={() => setI(k)}
              className={cn("h-2 rounded-full transition-all", k === i ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50")} data-testid={`dot-tour-${k}`} />)}
          </div>
          <div className="mt-4 flex gap-2">
            {i > 0 && !last && <button type="button" onClick={back} className="inline-flex h-11 items-center gap-1 rounded-full border border-border px-4 text-sm font-medium hover-elevate" data-testid="button-tour-back"><ArrowLeft className="h-4 w-4" />Back</button>}
            {last ? (
              <>
                <button type="button" onClick={() => finish("/me")} className="h-11 flex-1 whitespace-nowrap rounded-full border border-border text-sm font-semibold hover-elevate" data-testid="button-tour-profile">Finish my profile</button>
                <button type="button" onClick={() => finish("/")} className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-tour-done"><PlaneLanding className="h-4 w-4 shrink-0" />Start exploring</button>
              </>
            ) : (
              <button type="button" onClick={next} autoFocus className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-tour-next">{i === 0 ? "Show me around" : "Next"}<ArrowRight className="h-4 w-4" /></button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Small link to replay the tour. */
export function TourLink({ className }: { className?: string }) {
  return <button type="button" onClick={startTour} className={className} data-testid="button-take-tour">Take the tour</button>;
}
