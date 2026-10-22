import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronDown, Search, Sparkles, X } from "lucide-react";
import { POINTS, SOLO_POINTS, TIERS } from "@shared/tiers";
import { startTour } from "@/lib/tour";
import { openWhatsNew } from "@/lib/whatsNew";
import { FeedbackLink } from "@/lib/feedback";
import { useTrip } from "@/lib/experience";

type QA = { q: string; a: React.ReactNode; text: string };
const qa = (q: string, a: string, extra?: React.ReactNode): QA => ({ q, a: <>{a}{extra}</>, text: `${q} ${a}`.toLowerCase() });
const tiers = TIERS.map((t) => `${t.name} ${t.min.toLocaleString()}`).join(", ");

const SECTIONS: { title: string; items: QA[] }[] = [
  {
    title: "Getting started",
    items: [
      qa("What is Wheelsdown?", "A layover guide written by flight crews: where to eat, what to do, where to stay and which FBOs treat crews right. Every crew listing comes from someone who has been there."),
      qa("How do I search my route?", "Type the airport code for each stop, three letters (OPF) or four (KOPF), separated by spaces. Pick Eat, Do, Stay or FBO intel, then narrow it down by time, price, Grab & go or Sit-down, food type or type of thing to do. Switch to Map to see every pick along the route."),
      qa("What's on the home screen?", "Signed in, Wheelsdown opens on tiles for what you came to do: Find spots, Add a spot, Plan layover, Rate a spot, Crew lounge, Crew Up, My Crew, Leaderboard and Logbook. Each tile sets up the bottom bar for that job. Tap the Wheelsdown logo or Switch to come back."),
      qa("How do I get directions to a place?", "Tap Directions on the place, on a briefing pick or on the Plan layover screen, then choose Apple Maps or Google Maps. It opens your maps app with the route."),
      qa("Do I need an account?", "No, anyone can search. You need a free account to rate, add places, build briefings, save favorites and earn points."),
      qa("How do I put Wheelsdown on my home screen?", "On iPhone or iPad, open getwheelsdown.com in Safari, tap Share, then Add to Home Screen, then open it from the new icon. On Android, open it in Chrome, tap the menu, then Install app or Add to Home screen. From that icon, tap the gear on Logbook and Turn on notifications. On iPhone, notifications only work from the home-screen icon, not a Safari tab. They still arrive when the app is closed."),
    ],
  },
  {
    title: "Ratings and listings",
    items: [
      qa("How do ratings work?", "Rate from 1 to 5 stars. A Go around (0 stars) warns crews to avoid a place. You can add what you paid and a comment. Each place takes one rating per crew member: edit it later, or delete it from the listing."),
      qa("What is Rate a spot?", "A list of places you haven't rated yet: ones you checked in at, opened directions or a website for, had in a briefing, or saved as a favorite. Rate each in a couple of taps."),
      qa("How do I add a spot?", "Tap Add a spot on the home screen, Add spot in the bottom bar, or Add spot on any briefing stop. Enter the name, the airport and what crews should know. A moderator checks new listings before they go public."),
      qa("What does Crew-vetted mean?", "A listing with 3 or more upvotes in the last year, at least 75% positive. Crew-vetted only in the filters shows just those."),
      qa("Can I edit someone else's listing?", "No. Only the member who added a listing can edit it. If something is wrong or a place has closed, vote it down with a reason or send feedback, and we'll fix it."),
      qa("Why are prices shown as ranges?", "Prices change, so we show what crews reported as a dollar range per person (or per night for hotels), like Under $15 or $15–30."),
      qa("Will I be reminded to rate a place?", "Yes. If you open directions or a website for a place, or check in there, the home screen asks how it was a couple of hours later. Tap Didn't go to dismiss it. The reminder stays on your phone only."),
    ],
  },
  {
    title: "AI picks",
    items: [
      qa("What are AI picks?", "Where crews haven't listed a place yet, AI can suggest real nearby options. They are always tagged AI pick, with dashed numbers in briefings, and they don't count as crew ratings. Check hours before you go."),
      qa("Can I turn AI picks off, or have them fill in automatically?", "Yes. In your Logbook, Prefer crew shows only crew picks until you ask; Prefer AI fills gaps automatically. Crew picks always come first either way."),
      qa("I tried an AI pick. What now?", "Tap Been here? Add it for crews, then rate it. It becomes a crew listing, and the first crew member to add and rate it earns +10 points on top."),
      qa("How do I get more of one kind, like golf or sushi?", "In search, choose the type in the filters, then tap More places. In a briefing, tap Add places, choose the type, and Ask AI for more."),
    ],
  },
  {
    title: "Trip briefings",
    items: [
      qa("What's a trip briefing?", "A plan for every stop on your trip. Overnights get breakfast, lunch, dinner, things to do and a hotel. Your favorites are always included, and crew picks come first."),
      qa("How do I change what's in a briefing?", "Use Up, Down and Remove on any pick. Add places at each stop brings in more crew listings or AI picks by type. Re-pick starts that stop over."),
      qa("How do I send it to the crew?", "Tap Finalize briefing at the bottom to look it over. Preview PDF shows the exact pages before you send them. Then Share PDF or Share link. Anyone with the link can view it. Done takes you back to all your briefings."),
      qa("What is Plan layover?", "One screen for the airport you're at or headed to: Plan your day at that airport (starts a briefing for it in one tap), weather and the METAR, sunrise and sunset, your briefing picks for that stop, crew favorites nearby, and Crew Up. Each place has Directions and Rate right on the row."),
      qa("Can I delete a briefing?", "Yes, at the bottom of the briefing. Deleting can't be undone."),
    ],
  },
  {
    title: "My Crew, Crew Up and the Lounge",
    items: [
      qa("What is My Crew?", "The people you fly with. Send a crew request from someone's profile, from Find in My Crew, or with your invite link. Nothing is shared until they accept. Declining and removing are quiet: nobody is told."),
      qa("How do I remove someone from my crew?", "Open My Crew, tap the arrow on their row, then Remove from crew and Yes, remove. They aren't told, and they stop seeing your Crew Up plans and anything you share. You can also do it from their profile."),
      qa("What does my crew see?", "Your display name (even if you post anonymously), your profile and your Crew Up plans. In My Crew > Privacy you choose whether they also see your check-ins from the last 60 days and your favorites. Check-ins are off until you turn them on."),
      qa("What is Crew Up?", "Layover plans for your crew. Post that you're at an airport now, or plan ahead for a trip up to 30 days out, with an optional note and a public meeting place. You can have up to 6 plans at different airports or days. Only people in your crew see them, never anything more exact than the airport, and they end by themselves. Hotel names, room numbers and tail numbers aren't allowed."),
      qa("Can I choose who sees a Crew Up plan?", "Yes. Under Who sees it, keep All my crew or tap Pick crew and tick the people you want (Select all ticks everyone). Only those people see the plan and get the notification. Your plan card shows who it's shared with."),
      qa("How do I get back to the home screen?", "Tap the Wheelsdown logo at the top, or Switch in the bottom bar. Pick a different tile and the bottom bar changes to match."),
      qa("What is the Crew Lounge?", "A place to talk shop with other crews: questions, tips and airport intel. Mark useful answers Helpful; that's how Lounge points are earned. Tail numbers aren't allowed."),
      qa("Does My Crew earn points?", "No. Adding crew earns nothing, so there's no reason to collect strangers. In the Crew Lounge, points come only from Helpful votes by other members."),
    ],
  },
  {
    title: "Points and ratings ladder",
    items: [
      qa("How do I earn points?", `Add a listing ${POINTS.listing}, plus ${POINTS.listingVetted} when it becomes Crew-vetted. Rate a place ${POINTS.review}, plus ${POINTS.reviewDetail} for a real comment. Vote ${POINTS.vote}. You also earn when others upvote your listing (${POINTS.upvoteReceived}) or find your review helpful (${POINTS.helpfulReceived}).`),
      qa("What are the levels?", `Everyone starts as a Student and solos at ${SOLO_POINTS} points. Then: ${tiers}.`),
      qa("How do referrals work?", `Share your invite link from the Logbook. You earn ${POINTS.referral} points when someone signs up with it, once their account is created.`),
    ],
  },
  {
    title: "Privacy and account",
    items: [
      qa("Who can see my check-ins?", "Only you, unless you choose to share them with your crew in My Crew > Privacy (off by default, last 60 days only). Check-ins only work when your phone confirms you're at the place, and they build the private map in your Logbook."),
      qa("Can I post anonymously?", "Yes. In your Logbook profile, choose to post anonymously. Your name comes off everything you've posted, and your bio, badges and followers stay hidden."),
      qa("How do I delete my account?", "At the bottom of your Logbook. It permanently deletes your account, ratings, comments, votes and points. Listings you added stay up, credited to Former crew member."),
      qa("How do I know I have the latest version?", "The version number is at the bottom of every page and in your Logbook. Each release raises it by one. Updates install by themselves when you reopen the app, and Check for updates in your Logbook confirms you're current or updates on the spot."),
      qa("Something's broken or missing. Who do I tell?", "Tap Send feedback at the bottom of any page. We read every one."),
    ],
  },
];

/** Four-tab preview (Home, Plan, Crew): answers that changed with the new layout, keyed by the original question. */
const TRIP_QA: Record<string, [string, string]> = {
  "What's on the home screen?": ["What's on the home screen?", "Home opens on Spots: tap Eat, Do, Stay or FBO intel and type your route. The card at the top shows the airport you're at (or the last one you looked at) with local time and weather; tap it for Layover today. The bottom bar has three tabs: Home, Plan and Crew."],
  "How do I get back to the home screen?": ["How do I get back to the home screen?", "Tap Home in the bottom bar or the Wheelsdown logo at the top. Either one takes you back to the Eat, Do, Stay and FBO intel tiles."],
  "What's a trip briefing?": ["What's a trip sheet?", "A plan for every stop on your trip, under Plan. Each stop has a box for Hotels, Do and Eat. Crew picks come first, AI picks are below them, and your favorites are always included."],
  "How do I change what's in a briefing?": ["How do I change what's in a trip sheet?", "Use Up, Down and Remove on any pick. Each box has See more for more crew listings of that type, and Don't like what you see? asks AI for more; new finds pop in as they're found. Re-pick at the bottom of a stop starts that stop over."],
  "How do I send it to the crew?": ["How do I send a trip sheet to the crew?", "Scroll to the bottom of the sheet: Finalize, Preview PDF to see the exact pages, then Share PDF or Share link. Anyone with the link can view it."],
  "What is Plan layover?": ["What is Layover today?", "One screen for the airport you're at: local time, sunrise and sunset, weather and the METAR, crew plans there, your trip sheet picks and crew favorites. Open it from the card at the top of Home."],
  "Can I delete a briefing?": ["Can I delete a trip sheet?", "Yes. On Plan, tap Delete on the sheet's tile, then confirm. Deleting can't be undone."],
  "Can I choose who sees a Crew Up plan?": ["Who sees my Crew Up plan?", "Only the crew you pick under Who sees it. They're the only ones who see the plan and get the notification, and your plan card shows who it's shared with."],
};
/** New questions for the three-tab layout, added to the top of the section with this title. */
const TRIP_EXTRA: Record<string, QA[]> = {
  [SECTIONS[0].title]: [
    qa("Where did everything go?", "The bottom bar now has three tabs. Home is Spots search (Eat, Do, Stay, FBO intel, plus Map, Favorites and Rate at the top) with the field you're at on top. Plan has your trip sheets, which used to be called briefings. Crew has My Crew, Crew Up, Ranks and the Lounge. Your Logbook is the points at the top of the page. What moved, next to Take the tour above, walks through it in a minute."),
  ],
  "My Crew, Crew Up and the Lounge": [
    qa("How do I send a private message?", "Tap the chat bubble next to the Crew pills to see your conversations, or the bubble next to someone in My Crew to start one. You can message anyone who's in your crew. On a Crew Up plan, tap Messages to talk it over with everyone on the plan in one thread."),
    qa("Who can read my messages?", "Only the people in the conversation. Messages are encrypted on your phone before they're sent, so Wheelsdown and its admins can't read them, and they aren't moderated. Wheelsdown does know who messaged whom and when. To check nobody's keys were swapped, compare the Safety code in the conversation in person."),
    qa("Why can't I read some older messages?", "Each phone or browser has its own keys, so a new device can't read messages sent before it was set up. On iPhone, Safari and the home-screen app count as separate devices. Use the same one you started on, and new messages reach all your devices. Crew Up threads are deleted a week after the plan ends."),
  ],
  "Trip briefings": [
    qa("Do deleted trip sheets still count for badges?", "Yes. Flight Planner counts every trip sheet you've made, so cleaning up old ones doesn't take credit away. Sheets deleted before October 22, 2026 weren't recorded, so the count starts from the ones you had then."),
  ],
};
const TRIP_SECTIONS = SECTIONS.map((s) => ({
  title: s.title === "Trip briefings" ? "Trip sheets" : s.title,
  items: [...(TRIP_EXTRA[s.title] || []), ...s.items.map((x) => (TRIP_QA[x.q] ? qa(TRIP_QA[x.q][0], TRIP_QA[x.q][1]) : x))],
}));

export default function FaqPage() {
  const trip = useTrip();
  const base = trip ? TRIP_SECTIONS : SECTIONS;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const sections = useMemo(() => base.map((s) => ({ ...s, items: term ? s.items.filter((x) => term.split(/\s+/).every((w) => x.text.includes(w))) : s.items })).filter((s) => s.items.length), [term, base]);
  const count = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="space-y-5" data-testid="page-faq">
      <Link href="/me" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-faq-back"><ArrowLeft className="h-4 w-4" /> Logbook</Link>
      <header>
        <h1 className="text-xl font-semibold">Questions and answers</h1>
        <p className="mt-1 text-sm text-muted-foreground">How Wheelsdown works, in a minute or less.</p>
      </header>
      <div className="flex items-center rounded-2xl border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
        <Search className="ml-3.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions" className="h-11 w-full bg-transparent px-3 text-base outline-none" data-testid="input-faq-search" aria-label="Search questions" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear" className="mr-2 grid h-8 w-8 place-items-center rounded-full text-muted-foreground"><X className="h-4 w-4" /></button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => openWhatsNew()} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid="button-faq-whats-new"><Sparkles className="h-3.5 w-3.5" />What's new</button>
        <button type="button" onClick={() => startTour()} className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid="button-faq-tour">Take the tour</button>
        {trip && <button type="button" onClick={() => startTour("layout")} className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid="button-faq-layout-tour">What moved (1 min)</button>}
      </div>
      {sections.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card">
            {s.items.map((x) => {
              const isOpen = open === x.q || !!term;
              return (
                <div key={x.q}>
                  <button type="button" onClick={() => setOpen(open === x.q ? null : x.q)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover-elevate" data-testid={`button-faq-${x.q.slice(0, 24).toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                    <span className="text-sm font-medium">{x.q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && <p className="px-4 pb-3.5 text-sm leading-relaxed text-muted-foreground">{x.a}</p>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {!count && <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground" data-testid="text-faq-empty">No answer for that yet. <FeedbackLink className="font-semibold text-foreground underline" /></p>}
      <p className="text-center text-xs text-muted-foreground">Didn't find it? <FeedbackLink className="font-semibold text-foreground underline hover:text-primary" /></p>
    </div>
  );
}
