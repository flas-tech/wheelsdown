import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Bell, Check, ClipboardList, Coffee, Heart, Hotel, List, Map as MapIcon, MapPin, MessageSquare, PlaneLanding, Search, Share2, Smartphone, Sparkles, Star, UserPlus, UserRound, Users, UtensilsCrossed, CalendarDays, Navigation, PlusCircle, MessagesSquare, ThumbsUp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { POINTS, TIERS } from "@shared/tiers";
import { Insignia } from "@/lib/auth";
import { GoAroundIcon, Logo } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { skipWhatsNewForNewMember } from "@/lib/whatsNew";
import { usePreview, useTrip } from "@/lib/experience";
import { HomeScreenSteps } from "@/lib/push";

const DONE_KEY = "wheelsdown-tour-done";
const VERSION_KEY = "wheelsdown-tour-v";
/** Bump when steps are added; members who saw an older tour get a short "What's new" version once. */
const TOUR_VERSION = 2;
const EVENT = "wheelsdown:tour";

/** Open the tour from anywhere (Logbook link, right after sign-up). */
export type TourMode = "full" | "new" | "layout";
export function startTour(mode: TourMode = "full") {
  // the go-live notification prompt waits for the next visit if the tour already covered it this time
  try { sessionStorage.setItem("wd-tour-this-visit", "1"); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}
/** Signed-in members who finished an older version of the tour on this device see what's new, once. */
export function maybeShowWhatsNew() {
  try {
    if (!localStorage.getItem(DONE_KEY)) return;
    if (Number(localStorage.getItem(VERSION_KEY) || 1) >= TOUR_VERSION) return;
  } catch { return; }
  setTimeout(() => startTour("new"), 1200);
}
/** Called once a new account is created: show the tour unless they've already seen it on this device. */
export function startTourForNewMember() {
  skipWhatsNewForNewMember(); // the tour already covers what's new
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

/** preview: only shown when the new home screen, Plan layover, My Crew and the Lounge are open to this member. */
const STEPS: { key: string; title: string; body: string; art: React.ReactNode; extra?: React.ReactNode; isNew?: boolean; preview?: boolean }[] = [
  {
    key: "welcome", title: "Welcome to Wheelsdown",
    body: "Layover picks from crews who've actually been there: where to eat, what to do, where to stay and which FBOs treat you right. Here's a quick tour.",
    art: <div className="flex flex-col items-center gap-3"><Logo className="h-16 w-16" /><p className="text-lg font-bold tracking-tight">Wheels<span className="text-primary">down</span></p><p className="text-xs text-white/60">Crew-vetted layover guide</p></div>,
  },
  {
    key: "home", title: "Start with what you're doing", isNew: true, preview: true,
    body: "The home screen opens on tiles for each job: Find spots, Add a spot, Plan layover, Rate a spot, the Crew lounge, Crew Up, My Crew and more. Each one sets up the bottom bar for that job. Tap the logo or Switch to come back.",
    art: <div className="grid grid-cols-2 gap-2">
      {([[Search, "Find spots"], [PlusCircle, "Add a spot"], [ClipboardList, "Plan layover"], [Users, "Crew Up"]] as const).map(([I, t], k) => (
        <div key={t} className={cn("flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1", k === 0 ? "bg-primary text-[#0B1222] ring-primary" : "bg-white/[0.06] ring-white/10")}><I className="h-4 w-4 shrink-0" /><span className="text-xs font-semibold">{t}</span></div>
      ))}
    </div>,
  },
  {
    key: "search", title: "Search your whole route",
    body: "Type the airport codes for every stop (OPF or KOPF). Filter by time, price, Grab & go or Sit-down and food type, then switch to Map. Collect hotel points? Add your programs in Settings (the gear on your Logbook) and those hotels come first.",
    art: <div className="space-y-2.5">
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-[#0B1222]"><Search className="h-4 w-4 text-[#0B1222]/50" /><span className="flex-1 font-code text-sm tracking-widest">KOPF KTEB KASE</span>
        <span className="inline-flex overflow-hidden rounded-full border border-[#0B1222]/15 text-[10px] font-semibold"><span className="inline-flex items-center gap-0.5 px-1.5 py-0.5"><List className="h-3 w-3" />List</span><span className="inline-flex items-center gap-0.5 bg-[#0B1222] px-1.5 py-0.5 text-white"><MapIcon className="h-3 w-3" />Map</span></span></div>
      <div className="flex flex-wrap gap-1.5"><span className={chip}>Under 1 hr</span><span className={chip}>$$</span><span className={cn(chip, "bg-primary text-[#0B1222]")}>Grab &amp; go</span><span className={chip}>Pizza</span><span className={cn(chip, "inline-flex items-center gap-1 bg-sky-500 text-white")}><Hotel className="h-3 w-3" />Hilton</span></div>
    </div>,
  },
  {
    key: "today", title: "Layover today, on one screen", isNew: true, preview: true,
    body: "Plan layover shows the field you're at: local time, sunset, weather and the METAR, your briefing picks and crew favorites. Tap Plan your day for a briefing, or Directions on any place to open Apple Maps or Google Maps.",
    art: <div className="space-y-2">
      <div className="flex items-center justify-between rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10"><span className="font-code text-xl font-bold tracking-wider text-primary">KMKE</span><span className="text-right"><span className="block font-code text-sm font-bold">10:32 AM</span><span className="inline-flex items-center gap-1 text-[10px] text-white/60"><span className="rounded bg-emerald-500 px-1 font-bold text-white">VFR</span>48°F · wind 220° 9 kt</span></span></div>
      <div className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-[#0B1222]"><CalendarDays className="h-4 w-4" /><span className="flex-1 text-xs font-semibold">Plan your day at <span className="font-code">KMKE</span></span><ArrowRight className="h-3.5 w-3.5" /></div>
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[#0B1222]"><UtensilsCrossed className="h-4 w-4 text-[#0B1222]/60" /><span className="flex-1 truncate text-xs font-semibold">Oak Creek Diner</span><span className="inline-flex items-center gap-1 rounded-full border border-[#0B1222]/20 px-2 py-0.5 text-[10px] font-semibold"><Navigation className="h-3 w-3" />Directions</span></div>
    </div>,
  },
  {
    key: "ai", title: "No crew picks yet? Pick with AI", isNew: true,
    body: "Where crews haven't listed a place, tap Pick with AI for real nearby options, always tagged AI pick so you know they aren't crew-rated. Want more? Choose a food type or Surprise me for what the area is known for. Prefer crew or Prefer AI is in Settings, the gear on your Logbook.",
    art: <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10"><span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300"><Users className="h-3 w-3" />Crew pick</span><span className="text-sm font-semibold">Joe's Stone Crab</span></div>
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-violet-300/60 px-3 py-2"><span className="inline-flex items-center gap-1 rounded-full bg-violet-400/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-200"><Sparkles className="h-3 w-3" />AI pick</span><span className="text-sm font-semibold">Pastrami House</span></div>
      <div className="flex gap-1.5"><span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-semibold"><Sparkles className="h-3 w-3" />Surprise me</span><span className={chip}>Sushi</span><span className={chip}>Breakfast</span></div>
    </div>,
  },
  {
    key: "rate", title: "Rate it, or add what's missing", isNew: true,
    body: `Rate a spot lists places you've been but haven't rated. Rate one for ${POINTS.review} points, plus ${POINTS.reviewDetail} more for a real comment. One rating per place, and you can edit or delete it. Add a place crews haven't found for ${POINTS.listing}. Places to avoid get a Go around.`,
    art: <div className="rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
      <p className="text-sm font-semibold">Versailles Restaurant</p>
      <div className="mt-1.5 flex items-center gap-1">{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn("h-5 w-5", i <= 4 ? "fill-primary text-primary" : "text-white/25")} />)}<span className="ml-2 text-xs text-white/60">+{POINTS.review} pts</span></div>
      <div className="mt-2.5 flex flex-wrap gap-1.5"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"><Sparkles className="h-3.5 w-3.5" />First to rate an AI pick +10</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/60 px-2.5 py-1 text-[11px] font-semibold text-orange-300"><GoAroundIcon className="h-3.5 w-3.5" />Go around</span></div>
    </div>,
  },
  {
    key: "brief", title: "Trip briefings plan every stop", isNew: true,
    body: "Build a briefing for your route. Overnights get breakfast, lunch, dinner, things to do and a hotel. Crew picks come first and your favorites are always included. One Add places button brings in more crew listings or AI picks. Finalize it for a map, preview the PDF, then share it with the crew.",
    art: <div className="grid grid-cols-[1fr_auto_1.3fr] items-center gap-3">
      <div className="rounded-xl bg-white/[0.06] p-3 text-center ring-1 ring-white/10"><Heart className="mx-auto h-7 w-7 fill-rose-500 text-rose-500" /><p className="mt-1.5 text-[11px] text-white/70">Favorites</p></div>
      <ArrowRight className="h-4 w-4 text-white/40" />
      <div className="rounded-xl bg-white p-2.5 text-[#0B1222]">
        <p className="flex items-center gap-1 text-[11px] font-bold"><ClipboardList className="h-3.5 w-3.5" />KSBN · Overnight</p>
        <ul className="mt-1 space-y-0.5 text-[10px] leading-tight text-[#0B1222]/75">
          <li className="flex items-center gap-1"><Coffee className="h-3 w-3" />3 meals</li>
          <li className="flex items-center gap-1"><MapPin className="h-3 w-3" />2 things to do</li>
          <li className="flex items-center gap-1"><Hotel className="h-3 w-3" />Hotel</li>
        </ul>
      </div>
    </div>,
  },
  {
    key: "crew", title: "Your crew, Crew Up and the Lounge", isNew: true, preview: true,
    body: "Add crew you fly with to My Crew. It's mutual, and you choose what they see. Crew Up tells your crew you're out at an airport tonight. The Crew lounge is for questions and tips with every crew; Helpful answers earn Lounge points.",
    art: <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10"><span className="grid h-8 w-8 place-items-center rounded-full bg-sky-500 text-xs font-bold">SR</span><span className="flex-1 text-sm font-semibold">Sam Rivera</span><span className="rounded-full bg-primary/25 px-2 py-0.5 font-code text-[10px] font-bold text-primary">Crew Up · KTEB</span></div>
      <div className="rounded-xl bg-white px-3 py-2 text-[#0B1222]"><p className="flex items-center gap-1.5 text-xs font-semibold"><MessagesSquare className="h-3.5 w-3.5" />Best late-night food near KASE?</p>
        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800"><ThumbsUp className="h-3 w-3" />Helpful · 4</p></div>
    </div>,
  },
  {
    key: "ranks", title: "Earn points, climb the ratings",
    body: `Everything you add, rate and vote on earns points, from Student up through Private, Instrument, Commercial and ATP. Share your invite link from the Logbook and get ${POINTS.referral} points each time someone signs up with it.`,
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
    key: "profile", title: "Your Logbook, and telling us what to fix", isNew: true,
    body: "Your Logbook holds your points and badges, plus a private map of everywhere you've added or checked in. Tap the gear for Settings: your profile, notifications and AI picks. Finish your profile so crews know whose picks they're reading. Something wrong or missing? Tap Send feedback at the bottom of any page.",
    art: <div className="space-y-2.5">
      <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-[#0B1222]"><UserRound className="h-5 w-5" /></div>
        <div className="flex-1"><div className="h-2 w-24 rounded bg-white/50" /><div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-white/10"><div className="h-full w-3/5 rounded bg-primary" /></div></div></div>
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-[#0B1222]"><MapPin className="h-4 w-4" />My map</div>
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#0B1222]"><MessageSquare className="h-4 w-4" />Send feedback</div>
      </div>
    </div>,
  },
  {
    key: "install", title: "Add it to your home screen",
    body: "Then turn on notifications. Crew requests and Crew Up plans reach you even when the app is closed.",
    extra: <HomeScreenSteps compact />,
    art: <div className="flex items-center justify-center gap-4">
      <div className="w-36 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
        <div className="mb-2 flex items-center justify-between text-[10px] text-white/55"><span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" />Safari</span><Share2 className="h-3.5 w-3.5" /></div>
        <div className="rounded-lg bg-white px-2 py-2.5 text-center text-[11px] font-semibold text-[#0B1222]">Add to Home Screen</div>
      </div>
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary text-[#0B1222] shadow-xl"><Bell className="h-7 w-7" /></div>
    </div>,
  },
];

const TabsArt = ({ on = 0 }: { on?: number }) => (
  <div className="grid grid-cols-3 gap-1.5">
    {([[PlaneLanding, "Home"], [ClipboardList, "Plan"], [Users, "Crew"]] as const).map(([I, t], k) => (
      <div key={t} className={cn("flex flex-col items-center gap-0.5 rounded-xl py-2 ring-1", k === on ? "bg-primary text-[#0B1222] ring-primary" : "bg-white/[0.06] ring-white/10")}><I className="h-4 w-4" /><span className="text-[10px] font-semibold">{t}</span></div>
    ))}
  </div>
);
const FieldCardArt = () => (
  <div className="rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10"><p className="text-[9px] font-semibold uppercase tracking-wider text-white/50">At the field now</p><p className="flex items-baseline justify-between"><span className="font-code text-lg font-bold text-primary">KTEB</span><span className="font-code text-xs font-bold">7:26 PM</span></p><p className="mt-0.5 text-right text-[10px] font-semibold text-primary">Layover today ›</p></div>
);
const Pills = ({ items, on = 0 }: { items: string[]; on?: number }) => (
  <div className="grid gap-0.5 rounded-full bg-white/[0.06] p-0.5 ring-1 ring-white/10" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
    {items.map((t, k) => <span key={t} className={cn("rounded-full py-1 text-center text-[10px] font-semibold", k === on ? "bg-white text-[#0B1222]" : "text-white/70")}>{t}</span>)}
  </div>
);

/** Short tour for members who knew the old layout: where things moved (opened from What's new 1.16 and the FAQ). */
const LAYOUT_STEPS: (typeof STEPS)[number][] = [
  {
    key: "l-intro", title: "Wheelsdown has a new layout",
    body: "Same picks and the same crews, laid out around a trip. There are now three tabs at the bottom: Home, Plan and Crew. Here's where everything went. It takes about a minute.",
    art: <div className="space-y-3"><p className="text-center text-sm font-semibold">Three tabs</p><TabsArt /></div>,
  },
  {
    key: "l-home", title: "Home: find spots and the field you're at",
    body: "Home opens on Eat, Do, Stay and FBO intel, like before. Search, Map, Favorites and Rate are the pills at the top, and the + adds a spot. The card on top is the airport you're at; tap it for Layover today, which used to be Plan layover.",
    art: <div className="space-y-2"><FieldCardArt /><Pills items={["Search", "Map", "Favorites", "Rate"]} /></div>,
  },
  {
    key: "l-plan", title: "Plan: briefings are now trip sheets",
    body: "All your briefings are under Plan, now called trip sheets. Each stop has a box for Hotels, Do and Eat with crew picks first. Ask AI for more right in a box, then Finalize, Preview and Share at the bottom of the sheet. Deleting old sheets doesn't cost you badge credit.",
    art: <div className="space-y-2"><TabsArt on={1} />
      {[[Hotel, "Hotels"], [Star, "Do"], [UtensilsCrossed, "Eat"]].map(([I, t]: any) => <div key={t} className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10"><I className="h-3.5 w-3.5 text-primary" />{t}</div>)}
    </div>,
  },
  {
    key: "l-crew", title: "Crew: one tab for your people",
    body: "My Crew, Crew Up, Ranks (the leaderboard) and the Lounge are the pills at the top of Crew. Crew Up plans go to just the crew you pick. A red dot means something new is waiting.",
    art: <div className="space-y-2"><TabsArt on={2} /><Pills items={["My Crew", "Crew Up", "Ranks", "Lounge"]} on={1} /></div>,
  },
  {
    key: "l-logbook", title: "Your Logbook is the points at the top",
    body: "Tap your points at the top of any page for your Logbook, badges and map; the gear there opens Settings. Tap Home or the logo to get back to the start. You can take the full tour any time from the FAQ.",
    art: <div className="flex items-center justify-center gap-3"><span className="rounded-full bg-white px-3 py-1.5 font-code text-sm font-bold text-[#0B1222] ring-2 ring-primary">✦ 1,010</span><UserRound className="h-6 w-6 text-white/70" /></div>,
  },
];

/** Four-tab layout (Home, Plan, Crew): these steps replace the ones with the same key, so the tour matches the app. */
const TRIP_STEPS: Record<string, Partial<(typeof STEPS)[number]>> = {
  home: {
    title: "Three tabs: Home, Plan, Crew", preview: false,
    body: "Home opens on Spots. Tap Eat, Do, Stay or FBO intel, type your route, then switch between List and Map. The card on top shows the airport you're at; tap it for Layover today. Tap Home or the logo any time to come back to this page.",
    art: <div className="space-y-2.5"><FieldCardArt /><TabsArt /></div>,
  },
  today: {
    title: "Layover today, from the Home card", preview: false,
    body: "Tap the card at the top of Home. Layover today shows local time, sunset, weather and the METAR, crew plans at the field, your trip sheet picks and crew favorites. Directions on any place opens Apple Maps or Google Maps.",
  },
  brief: {
    title: "Plan: trip sheets for every stop",
    body: "Plan holds your trip sheets. Add your route and dates, and each stop gets a box for Hotels, Do and Eat: crew picks first, AI picks below. Don't like what you see? Ask AI for more in that box and watch the finds pop in. Drag and pinch the maps to look around. Finalize, preview the PDF and share it at the bottom.",
  },
  profile: {
    body: "Tap your points at the top of any page for your Logbook: points, badges and a private map of everywhere you've added or checked in. The gear there opens Settings: your profile, notifications and AI picks. Something wrong or missing? Tap Send feedback at the bottom of any page.",
  },
  crew: {
    title: "Crew: your crew and Crew Up", preview: false,
    body: "Crew holds My Crew, Crew Up, Ranks and the Lounge. Add crew you fly with; it's mutual. Crew Up a plan at an airport: pick a spot from your trip sheet or type a place, then pick who sees it. A red dot means there's a new plan, and tapping the notification opens it.",
  },
};

/** Mounted once in the app shell; opens on startTour(). Skippable at any step. */
export function TourHost() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<TourMode>("full");
  const preview = usePreview();
  const trip = useTrip();
  const steps = mode === "layout" ? LAYOUT_STEPS
    : STEPS.map((x) => (trip && TRIP_STEPS[x.key] ? { ...x, ...TRIP_STEPS[x.key] } : x)).filter((x) => (preview || !x.preview) && (mode === "full" || x.isNew));
  const [, navigate] = useLocation();
  const touch = useRef<number | null>(null);
  // release notes after the tour's own "What's new" (v2) live in whatsNew.tsx, shown once per release per member
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; setMode(d === "new" || d === "layout" ? d : "full"); setI(0); setOpen(true); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const finish = (to?: string) => {
    try { localStorage.setItem(DONE_KEY, String(Date.now())); localStorage.setItem(VERSION_KEY, String(TOUR_VERSION)); } catch { /* ignore */ }
    setOpen(false);
    // keep ?query inside the hash; the hash router otherwise drops it onto the page address
    if (to) { if (to.includes("?")) window.location.hash = `#${to}`; else navigate(to); }
  };
  const last = i === steps.length - 1;
  const s = steps[i];
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
        <div className="max-h-[min(52vh,calc(100dvh-22rem))] overflow-y-auto p-5 pb-2 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="text-tour-step">{mode === "new" ? "What's new · " : mode === "layout" ? "What moved · " : ""}{i + 1} of {steps.length}</p>
          <DialogTitle className="mt-1 text-lg font-semibold leading-snug" data-testid="text-tour-title">{s.title}</DialogTitle>
          <DialogDescription className={cn("mt-1.5 text-sm leading-relaxed text-muted-foreground", s.extra ? "" : "min-h-[88px]")}>{s.body}</DialogDescription>
          {s.extra && <div className="mt-3">{s.extra}</div>}
          <div className="mt-4 flex justify-center gap-1.5" role="tablist" aria-label="Tour steps">
            {steps.map((x, k) => <button key={x.key} type="button" role="tab" aria-selected={k === i} aria-label={`Step ${k + 1}: ${x.title}`} onClick={() => setI(k)}
              className={cn("h-2 rounded-full transition-all", k === i ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50")} data-testid={`dot-tour-${k}`} />)}
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5 pt-3">
            {i > 0 && !last && <button type="button" onClick={back} className="inline-flex h-11 items-center gap-1 rounded-full border border-border px-4 text-sm font-medium hover-elevate" data-testid="button-tour-back"><ArrowLeft className="h-4 w-4" />Back</button>}
            {last && s.key === "install" ? (
              <div className="flex w-full flex-col gap-2">
                <button type="button" onClick={() => finish("/settings?s=push")} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-tour-notify"><Bell className="h-4 w-4 shrink-0" />Turn on notifications</button>
                <button type="button" onClick={() => finish("/")} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold hover-elevate" data-testid="button-tour-done"><PlaneLanding className="h-4 w-4 shrink-0" />Start exploring</button>
                <button type="button" onClick={() => finish("/settings?focus=pf-displayName")} className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground" data-testid="button-tour-profile">Finish my profile</button>
              </div>
            ) : last && mode === "layout" ? (
              <>
                <button type="button" onClick={() => { setMode("full"); setI(0); }} className="h-11 flex-1 whitespace-nowrap rounded-full border border-border text-sm font-semibold hover-elevate" data-testid="button-tour-full">Full tour</button>
                <button type="button" onClick={() => finish("/")} className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-tour-done"><PlaneLanding className="h-4 w-4 shrink-0" />Got it</button>
              </>
            ) : last ? (
              <>
                <button type="button" onClick={() => finish("/me")} className="h-11 flex-1 whitespace-nowrap rounded-full border border-border text-sm font-semibold hover-elevate" data-testid="button-tour-profile">Finish my profile</button>
                <button type="button" onClick={() => finish("/")} className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-tour-done"><PlaneLanding className="h-4 w-4 shrink-0" />Start exploring</button>
              </>
            ) : (
              <button type="button" onClick={next} autoFocus className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-tour-next">{i === 0 && mode !== "new" ? "Show me around" : "Next"}<ArrowRight className="h-4 w-4" /></button>
            )}
          </div>
      </DialogContent>
    </Dialog>
  );
}

/** Small link to replay the tour. */
export function TourLink({ className }: { className?: string }) {
  return <button type="button" onClick={() => startTour()} className={className} data-testid="button-take-tour">Take the tour</button>;
}
