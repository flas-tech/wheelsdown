// Sign-up prompts for people without an account (guest limits, Nov 2026). The server decides what a guest gets;
// these only explain what an account adds and open the sign-in sheet.
import { Lock, Plane } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const PITCHES = {
  today: { title: "Layover Today", body: "Everything for the field you're at, on one screen: crew picks for food, rest and things to do nearby." },
  meetup: { title: "Crew Up", body: "Make layover plans with your crew, tonight or for a trip coming up. Only the people you pick see them." },
  rate: { title: "Rate a spot", body: "Rate the places you've been so the next crew knows where to go and what to skip, and earn points for it." },
  mycrew: { title: "My Crew", body: "Add the people you fly with. You both agree before anything is shared." },
  lounge: { title: "Crew Lounge", body: "Ask other crews about fields, hotels and FBOs, and share what you know." },
} as const;
export type PitchKey = keyof typeof PITCHES;

/** Full-page card in place of a members' page. */
export function GuestPitch({ k }: { k: PitchKey }) {
  const { openAuth } = useAuth();
  const p = PITCHES[k];
  return (
    <div className="py-10" data-testid={`guest-pitch-${k}`}>
      <div className="rounded-2xl border border-card-border bg-card p-6 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-primary/15"><Plane className="h-5 w-5 text-primary" /></span>
        <h1 className="mt-3 text-lg font-semibold">{p.title} is for crew members</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{p.body}</p>
        <button type="button" onClick={() => openAuth(`Create a free account to use ${p.title}.`)} className="mt-4 inline-flex h-10 items-center rounded-full taxi-sign px-5 text-sm font-semibold hover-elevate" data-testid={`button-guest-join-${k}`}>Create free account</button>
        <p className="mt-2 text-xs text-muted-foreground">Free for crew. Takes under a minute.</p>
      </div>
    </div>
  );
}

/** Small inline card where a guest would see more with an account. */
export function GuestLock({ text, reason, testId, className }: { text: string; reason?: string; testId: string; className?: string }) {
  const { openAuth } = useAuth();
  return (
    <button type="button" onClick={() => openAuth(reason || text)} className={cn("flex w-full items-center gap-2.5 rounded-xl border border-dashed border-primary/50 bg-primary/5 p-3 text-left text-sm hover-elevate", className)} data-testid={testId}>
      <Lock className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">{text}</span>
      <span className="shrink-0 rounded-full taxi-sign px-3 py-1 text-xs font-semibold">Sign up free</span>
    </button>
  );
}

const SEARCH_KEY = "wd-guest-searches";
/** Counts a guest's route searches this visit (for the soft sign-up card after a few). */
export function countGuestSearch(): number {
  try { const n = (Number(sessionStorage.getItem(SEARCH_KEY)) || 0) + 1; sessionStorage.setItem(SEARCH_KEY, String(n)); return n; } catch { return 0; }
}
export function guestSearches(): number { try { return Number(sessionStorage.getItem(SEARCH_KEY)) || 0; } catch { return 0; } }
