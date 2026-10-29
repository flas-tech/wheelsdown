// Signed-out visitors who search get one friendly look at what a free account adds (feedback #55).
// Shown a few seconds after their first results load, at most once every 3 days per device, never to members.
import { useEffect, useState } from "react";
import { CalendarDays, ClipboardList, Contact, Heart, MessagesSquare, ShieldAlert, Star } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";

const KEY = "wd-guest-prompt";
const EVERY_MS = 3 * 24 * 3600_000;
const DELAY_MS = 3500;

const PERKS = [
  { icon: ShieldAlert, title: "Ramp check reports", body: "Report when and where ramp checks are happening, and see hot spots worldwide on a map before you land." },
  { icon: ClipboardList, title: "Trip briefings", body: "Plan every stop on a trip, then share it as a link or a PDF." },
  { icon: CalendarDays, title: "Layover today", body: "Your airport's picks in one place, with directions in Apple or Google Maps." },
  { icon: Contact, title: "My Crew and Crew Up", body: "Connect with people you fly with and make layover plans only they see." },
  { icon: Heart, title: "Favorites", body: "Save the spots you like at every field." },
  { icon: Star, title: "Rate and add spots", body: "Earn points, badges and status for helping other crews." },
  { icon: MessagesSquare, title: "Crew Lounge", body: "Ask other crew members about a layover." },
];

const due = () => {
  try { return Date.now() - Number(localStorage.getItem(KEY) || 0) > EVERY_MS; } catch { return false; }
};

/** Mount next to search results. `ready` = a guest's search has finished and shows results. */
export function GuestJoinPrompt({ ready, icao }: { ready: boolean; icao?: string }) {
  const { me, loading, openAuth } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || me || loading || !due()) return;
    const t = setTimeout(() => {
      if (!due()) return;
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ }
      setOpen(true);
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [ready, me, loading]);
  if (me) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" data-testid="dialog-guest-join">
        <DialogTitle className="text-lg">Flying {icao ? `into ${icao}` : "a trip"}? There's more for crew</DialogTitle>
        <DialogDescription>A free Wheelsdown account adds:</DialogDescription>
        <ul className="space-y-2.5">
          {PERKS.map((p) => (
            <li key={p.title} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><p.icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold">{p.title}</span><span className="block text-xs text-muted-foreground">{p.body}</span></span>
            </li>
          ))}
        </ul>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-full border border-border text-sm font-medium hover-elevate" data-testid="button-guest-later">Keep browsing</button>
          <button type="button" onClick={() => { setOpen(false); setTimeout(() => openAuth("Free for crew. Takes about a minute."), 150); }} className="h-11 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-guest-join">Create free account</button>
        </div>
        <p className="text-center text-[11px] text-muted-foreground">Searching stays free without an account.</p>
      </DialogContent>
    </Dialog>
  );
}
