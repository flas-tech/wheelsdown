import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckSquare, TicketPercent, QrCode, Armchair, PlaneLanding, Check } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api, get, fboQuery } from "./api";
import { useMe } from "./App";
import { btn, btnGhost, btnPrimary } from "./ui";

/** First-sign-in walkthrough. Shown until the user finishes or skips it; "Replay welcome" on the dashboard reopens it. */
export function Welcome({ onClose }: { onClose: () => void }) {
  const { me } = useMe();
  const [, nav] = useLocation();
  const [i, setI] = useState(0);
  const { data: s } = useQuery<{ places: number; offers: number; intel: number; prints: number }>({ queryKey: ["/api/fbo/stats"], queryFn: get("/api/fbo/stats") });
  const a = me.account;
  const finish = (to?: string) => {
    api("PATCH", "/api/fbo/me", { onboarded: true }).then(() => fboQuery.invalidateQueries({ queryKey: ["/api/fbo/me"] })).catch(() => {});
    onClose();
    if (to) nav(to);
  };
  const steps = [
    { icon: PlaneLanding, title: `Welcome to Wheelsdown, ${a.name}`, body: <>
      <p>Every day crews walk up to your desk and ask where to eat and where to stay. Wheelsdown puts your answer on their phone.</p>
      <ul className="mt-3 space-y-2">
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Your picks, crew rates and discount codes on one page for {a.icao}, labeled as coming from {a.name}.</li>
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Ratings from real crews next to each pick, so your list keeps getting better.</li>
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />One QR code at the desk or in the pilot lounge. Crews scan it with their camera: no app, no sign-in.</li>
        <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Free while we're getting started. Your whole team can share this account.</li>
      </ul>
      <p className="mt-3 text-muted-foreground">Setup takes about ten minutes. Here's the order that works best.</p>
    </> },
    { icon: CheckSquare, title: "1. Check the places you already recommend", done: (s?.places || 0) > 0, body: <>
      <p>Recommendations shows every restaurant, hotel and thing to do crews have listed at {a.icao}. Put a check mark next to the ones your desk sends crews to, and add a note or crew rate if you like.</p>
      <p className="mt-2">Not on the list? Type the name and use <b>AI look it up</b> to fill in the address and details, then check it. Already have a list in Excel or Google Sheets? Use <b>Bulk upload</b>.</p>
      <p className="mt-2 text-muted-foreground">Aim for at least five places before you print. Star two or three favorites so they show first.</p>
    </> },
    { icon: TicketPercent, title: "2. Add a crew discount and your FBO intel (optional)", done: (s?.offers || 0) + (s?.intel || 0) > 0, body: <>
      <p>Have a crew rate at a hotel or a code for a restaurant? Add it under <b>Discounts</b> and it shows on that place, with an end date if it expires.</p>
      <p className="mt-2">Under <b>FBO intel</b>, fill in what crews always ask: hours, fuel, fees, crew car, lounge, Wi-Fi. It's labeled as provided by {a.name}.</p>
    </> },
    { icon: QrCode, title: "3. Print your QR code for the front desk", done: (s?.prints || 0) > 0, body: <>
      <p>Once a few places are checked, go to <b>QR & print</b>. Print the counter sign for the desk and a sheet of business cards to hand out.</p>
      <p className="mt-2">The code never changes. When you update your picks, everything you've already printed shows the new list.</p>
    </> },
    { icon: Armchair, title: "4. Make the pilot lounge self-serve", body: <>
      <p>Print the <b>pilot lounge sign</b> and put it on the wall or a table. Crews scan it and plan their layover without waiting at the desk.</p>
      <p className="mt-2">Have a spare tablet? Open your <b>kiosk page</b> on it and leave it in the lounge. It shows your picks with a QR code so crews can take the list with them.</p>
      <p className="mt-2 text-muted-foreground">Your dashboard shows how many crews open your page and how many scan the QR code.</p>
    </> },
  ];
  const st = steps[i], last = i === steps.length - 1;
  return (
    <Dialog open onOpenChange={(o) => !o && finish()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" data-testid="dialog-welcome">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><st.icon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <DialogTitle className="text-lg leading-tight">{st.title}</DialogTitle>
            <DialogDescription className="text-xs">{i === 0 ? "Getting started" : `Step ${i} of ${steps.length - 1}`}{st.done ? " · done" : ""}</DialogDescription>
          </div>
        </div>
        <div className="text-sm leading-relaxed" data-testid={`welcome-step-${i}`}>{st.body}</div>
        <div className="flex justify-center gap-1.5 pt-1">{steps.map((_, k) => <span key={k} className={cn("h-1.5 rounded-full", k === i ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30")} />)}</div>
        <div className="flex items-center justify-between gap-2">
          {i === 0 ? <button className={btnGhost} onClick={() => finish()} data-testid="button-welcome-skip">Skip for now</button> : <button className={btn} onClick={() => setI(i - 1)}><ArrowLeft className="h-4 w-4" />Back</button>}
          {last ? <button className={btnPrimary} onClick={() => finish("/places")} data-testid="button-welcome-start">Start checking places<ArrowRight className="h-4 w-4" /></button>
            : <button className={btnPrimary} onClick={() => setI(i + 1)} data-testid="button-welcome-next">{i === 0 ? "Show me how" : "Next"}<ArrowRight className="h-4 w-4" /></button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
