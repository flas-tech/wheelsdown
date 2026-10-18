// What's new: a short screen the first time a member signs in (or opens the app) after a release.
// EVERY RELEASE: add an entry at the top of RELEASES with the next id. Members see the entries newer than the last one
// they saw (stored on their account, so once per release on any device). New members skip it: the welcome tour covers it.
// FEATURES IN DEVELOPMENT (admin-only, e.g. Crew Lounge): don't add What's new entries for them, and don't bump the id for
// admin-only releases. If an entry is written ahead of launch, tag it with feature: "lounge"; it stays hidden until that
// feature is listed in PUBLIC_FEATURES.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BadgeCheck, Contact, LayoutGrid, MessagesSquare, Trash2, Users, MapPinned, PanelBottom, ArrowUpDown, BellRing, CircleHelp, ClipboardCheck, Compass, Flame, ListPlus, RefreshCw, Sparkles, Star, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/lib/ui";

type Item = { icon: typeof Star; title: string; body: string; to?: string; feature?: DevFeature };
export type Release = { id: number; date: string; items: Item[] };
/** Features still being built for admins only. Add one to PUBLIC_FEATURES on launch day. */
type DevFeature = "lounge";
const PUBLIC_FEATURES = new Set<DevFeature>([]);

const ALL_RELEASES: Release[] = [
  {
    id: 10, date: "October 17, 2026",
    items: [
      { icon: LayoutGrid, title: "A new home screen", body: "Open the app and pick what you're here for: plan a layover, find spots, or hang out in the Crew Lounge. The bottom bar changes to match. Prefer the old layout? Tap Use the classic app.", to: "/start" },
      { icon: Contact, title: "My Crew", body: "Add the people you fly with. You both have to agree, and you choose what they see: your check-ins, your favorites, or neither. Find crew by name or @handle, or send your invite link.", to: "/mycrew" },
      { icon: Users, title: "Crew Up", body: "Make layover plans with your crew at the airport you're at. Only people in your crew see them, nothing more precise than the airport is shared, and plans end by themselves.", to: "/meetup" },
      { icon: MessagesSquare, title: "Crew Lounge", body: "Ask other crews, share what you know about airports, gear and layover life. Helpful answers earn Lounge points. Tail numbers are never allowed.", to: "/lounge" },
      { icon: Star, title: "Layover Today and Rate a spot", body: "Layover Today shows the field you're at: local time, weather, sunrise and your picks. Rate a spot lists the places you've been that still need your rating.", to: "/today" },
      { icon: Trash2, title: "Delete your own rating", body: "Posted a rating twice, or changed your mind? Delete your own rating from the listing. Each place now takes one rating per crew member, so you edit it instead of adding another." },
    ],
  },
  {
    id: 9, date: "October 15, 2026",
    items: [
      { icon: Sparkles, title: "Find with AI is much faster", body: "AI now starts from real places on the map near the field and picks the best, instead of searching from scratch. Results usually arrive in under 30 seconds, and nearby places show up right away marked Checking while AI reviews them." },
      { icon: MapPinned, title: "Better results for a specific search", body: "Searching for one kind of food or thing to do, like spas, golf or sushi, now returns places of that kind only, with exact map pins. Place data comes from OpenStreetMap contributors." },
    ],
  },
  {
    id: 8, date: "October 15, 2026",
    items: [
      { icon: BadgeCheck, title: "Version numbers", body: "Wheelsdown now shows its version, so you know you're on the latest. It's at the bottom of every page and in your Logbook, where Check for updates confirms you're current or updates on the spot.", to: "/me" },
    ],
  },
  {
    id: 7, date: "October 15, 2026",
    items: [
      { icon: ClipboardCheck, title: "Been here? Add it for crews, fixed", body: "Tapping it on an AI pick now opens Add a spot with the name, address, website, price, distance, description and tags filled in, ready for you to check and tap Add spot." },
    ],
  },
  {
    id: 6, date: "October 15, 2026",
    items: [
      { icon: ClipboardCheck, title: "Adding an AI pick fills in the form", body: "Tap Been here? Add it for crews on an AI pick and the name, address, website, price, distance, description and tags are already filled in. Check it, add your crew tip and rate it." },
    ],
  },
  {
    id: 5, date: "October 14, 2026",
    items: [
      { icon: PanelBottom, title: "Tab bar stays at the bottom", body: "On iPhone, the tab bar could float partway up the screen after the keyboard closed. It now stays at the bottom, and it steps aside while you type." },
    ],
  },
  {
    id: 4, date: "October 13, 2026",
    items: [
      { icon: ListPlus, title: "One Add places button per stop", body: "Briefings now list crew picks first. Add places shows the other crew listings (vetted and best rated on top), then AI picks, by type, with sorting. Ask AI for more right there.", to: "/brief" },
      { icon: Sparkles, title: "More places in search too", body: "Search works the same way: crew picks first, then one More places button for AI picks of the same kind and type." },
      { icon: BellRing, title: "Been there? Rate it", body: "Opened directions or a website for a place, or checked in? A couple of hours later the home screen asks how it was, so the next crew knows." },
      { icon: Undo2, title: "Done after you share", body: "After you send a briefing from Finalize, Done takes you back to all your briefings." },
      { icon: CircleHelp, title: "FAQ", body: "Answers to common questions: points, ratings, AI picks, briefings, privacy. In your Logbook and at the bottom of every page.", to: "/faq" },
    ],
  },
  {
    id: 3, date: "October 12, 2026",
    items: [
      { icon: ArrowUpDown, title: "Edit every briefing pick", body: "Move AI picks up or down, or remove them, just like crew picks. Crew picks have solid numbers, AI picks dashed ones, with a short reason like Fills lunch." },
      { icon: ClipboardCheck, title: "Finalize briefing", body: "A button at the bottom previews the whole trip, then sends the PDF or a link." },
      { icon: Compass, title: "Things to do by type", body: "Golf, fishing and boating, spa, beach, parks, museums and more, in search and in briefings." },
      { icon: Flame, title: "Top rated, Most visited, Newest", body: "Switch the highlights on the home screen. Most visited counts ratings and check-ins." },
      { icon: RefreshCw, title: "Always the latest version", body: "The home-screen app updates itself when you reopen it. No need to re-add the shortcut." },
    ],
  },
];
/** What members see: entries for features still in development are dropped, and so are releases left empty. */
export const RELEASES: Release[] = ALL_RELEASES
  .map((r) => ({ ...r, items: r.items.filter((it) => !it.feature || PUBLIC_FEATURES.has(it.feature)) }))
  .filter((r) => r.items.length > 0);
export const LATEST_RELEASE = RELEASES[0].id;
/** Notes from before this system (id 2 and earlier) were shown by the tour's What's new. */
const FIRST_ID = 3;

const EVENT = "wheelsdown:whatsnew";
let skipCheck = false;
const markSeen = (n = LATEST_RELEASE) => apiRequest("PUT", "/api/me/release-seen", { seen: n })
  .then((r) => r.json()).then((r) => queryClient.setQueryData(["/api/me/release-seen"], r)).catch(() => {});

/** New account: the welcome tour covers everything, so mark the current notes as seen. */
export function skipWhatsNewForNewMember() { skipCheck = true; void markSeen(); }
/** Open the notes again (FAQ, Logbook). */
export function openWhatsNew() { window.dispatchEvent(new Event(EVENT)); }

/** Mounted once in the app shell. */
export function WhatsNewHost() {
  const { me } = useAuth();
  const [, navigate] = useLocation();
  const [show, setShow] = useState<Release[] | null>(null);
  const { data } = useQuery<{ seen: number | null }>({ queryKey: ["/api/me/release-seen"], enabled: !!me, staleTime: Infinity });
  useEffect(() => {
    if (!me || !data || skipCheck || show) return;
    const seen = data.seen ?? FIRST_ID - 1;
    const fresh = RELEASES.filter((r) => r.id > seen && r.id >= FIRST_ID).slice(0, 3);
    if (!fresh.length) return;
    // let the page (and any sign-in dialog) settle first
    const t = setTimeout(() => { if (!document.querySelector("[role=dialog]")) setShow(fresh); }, 1200);
    return () => clearTimeout(t);
  }, [me?.id, data?.seen]); // eslint-disable-line
  useEffect(() => {
    const on = () => setShow(RELEASES.slice(0, 2));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = (to?: string) => {
    setShow(null);
    if (me && (data?.seen ?? 0) < LATEST_RELEASE) void markSeen();
    if (to) navigate(to);
  };
  if (!show) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[88vh] max-w-md gap-0 overflow-y-auto rounded-2xl p-0 [&>button]:hidden" data-testid="dialog-whats-new">
        <div className="relative overflow-hidden rounded-t-2xl bg-[#0B1222] px-5 pb-5 pt-6 text-white">
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "18px 18px" }} aria-hidden />
          <div className="relative flex items-center gap-3">
            <Logo className="h-10 w-10" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">What's new</p>
              <DialogTitle className="text-lg font-semibold leading-tight text-white">Fresh in Wheelsdown</DialogTitle>
            </div>
          </div>
          <DialogDescription className="relative mt-2 text-xs text-white/70">Version 1.{show[0].id} · {show[0].date}. Here's what changed since you last looked.</DialogDescription>
        </div>
        <div className="space-y-5 px-5 py-4">
          {show.map((r, k) => (
            <section key={r.id} data-testid={`section-release-${r.id}`}>
              {(show.length > 1 || k > 0) && <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Version 1.{r.id} · {r.date}</p>}
              <ul className="space-y-3">
                {r.items.map((it) => (
                  <li key={it.title} className="flex gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-foreground"><it.icon className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{it.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{it.body}</p>
                      {it.to && <button type="button" onClick={() => close(it.to)} className="mt-1 text-xs font-semibold text-foreground underline underline-offset-2" data-testid={`link-whats-new-${it.to.replace(/\W/g, "")}`}>Take a look</button>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="sticky bottom-0 border-t border-border bg-background p-3">
          <button type="button" onClick={() => close()} autoFocus className="h-11 w-full rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-whats-new-done">Got it</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
