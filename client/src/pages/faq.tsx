import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronDown, Search, Sparkles, X } from "lucide-react";
import { POINTS, SOLO_POINTS, TIERS } from "@shared/tiers";
import { startTour } from "@/lib/tour";
import { openWhatsNew } from "@/lib/whatsNew";
import { FeedbackLink } from "@/lib/feedback";

type QA = { q: string; a: React.ReactNode; text: string };
const qa = (q: string, a: string, extra?: React.ReactNode): QA => ({ q, a: <>{a}{extra}</>, text: `${q} ${a}`.toLowerCase() });
const tiers = TIERS.map((t) => `${t.name} ${t.min.toLocaleString()}`).join(", ");

const SECTIONS: { title: string; items: QA[] }[] = [
  {
    title: "Getting started",
    items: [
      qa("What is Wheelsdown?", "A layover guide written by flight crews: where to eat, what to do, where to stay and which FBOs treat crews right. Every crew listing comes from someone who has been there."),
      qa("How do I search my route?", "Type the airport code for each stop, three letters (OPF) or four (KOPF), separated by spaces. Pick Eat, Do, Stay or FBO intel, then narrow it down by time, price, Grab & go or Sit-down, food type or type of thing to do. Switch to Map to see every pick along the route."),
      qa("Do I need an account?", "No, anyone can search. You need a free account to rate, add places, build briefings, save favorites and earn points."),
      qa("How do I put Wheelsdown on my home screen?", "On iPhone, open getwheelsdown.com in Safari, tap Share, then Add to Home Screen. It updates itself when you reopen it, so you never need to add it again."),
    ],
  },
  {
    title: "Ratings and listings",
    items: [
      qa("How do ratings work?", "Rate from 1 to 5 stars. A Go around (0 stars) warns crews to avoid a place. You can add what you paid and a comment, and edit your rating later."),
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
      qa("How do I send it to the crew?", "Tap Finalize briefing at the bottom to preview it, then Share PDF or Share link. Anyone with the link can view it. Done takes you back to all your briefings."),
      qa("Can I delete a briefing?", "Yes, at the bottom of the briefing. Deleting can't be undone."),
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
      qa("Who can see my check-ins?", "Only you. Check-ins only work when your phone confirms you're at the place, and they build the private map in your Logbook."),
      qa("Can I post anonymously?", "Yes. In your Logbook profile, choose to post anonymously. Your name comes off everything you've posted, and your bio, badges and followers stay hidden."),
      qa("How do I delete my account?", "At the bottom of your Logbook. It permanently deletes your account, ratings, comments, votes and points. Listings you added stay up, credited to Former crew member."),
      qa("How do I know I have the latest version?", "The version number is at the bottom of every page and in your Logbook. Each release raises it by one. Updates install by themselves when you reopen the app, and Check for updates in your Logbook confirms you're current or updates on the spot."),
      qa("Something's broken or missing. Who do I tell?", "Tap Send feedback at the bottom of any page. We read every one."),
    ],
  },
];

export default function FaqPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const sections = useMemo(() => SECTIONS.map((s) => ({ ...s, items: term ? s.items.filter((x) => term.split(/\s+/).every((w) => x.text.includes(w))) : s.items })).filter((s) => s.items.length), [term]);
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
