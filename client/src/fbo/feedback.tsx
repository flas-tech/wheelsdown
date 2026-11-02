import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FEEDBACK_MAX, type FeedbackKind } from "@shared/feedback";
import { api } from "./api";

const KINDS: [FeedbackKind, string][] = [["idea", "Idea or request"], ["bug", "Something's broken"], ["listing", "Problem with a listing"], ["praise", "Something I like"], ["other", "Other"]];

/** Feedback from the FBO portal. Goes to the Wheelsdown team's private inbox with the FBO's name and the sender's login email. */
export function FboFeedbackDialog({ open, onOpenChange, email }: { open: boolean; onOpenChange: (o: boolean) => void; email: string }) {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [hp, setHp] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => api("POST", "/api/fbo/feedback", { kind, message, page: window.location.hash.replace(/^#/, "").split("?")[0] || "/", website: hp }),
    onSuccess: () => { setSent(true); setMessage(""); },
  });
  const close = (o: boolean) => { onOpenChange(o); if (!o) setTimeout(() => { setSent(false); send.reset(); }, 200); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md" data-testid="dialog-fbo-feedback">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Ideas, bugs, something on your crew page that's wrong. It goes straight to the Wheelsdown team and isn't shown to crews.</DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center" data-testid="text-fbo-feedback-sent">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/15"><Check className="h-6 w-6 text-primary" /></span>
            <p className="font-semibold">Thanks, got it.</p>
            <p className="text-sm text-muted-foreground">We read every message and reply by email when there's something to follow up on.</p>
            <button onClick={() => close(false)} className="mt-2 h-10 rounded-full taxi-sign px-5 text-sm font-semibold" data-testid="button-fbo-feedback-done">Done</button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type of feedback">
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} data-testid={`chip-fbo-feedback-${k}`}
                  className={cn("h-9 rounded-full border px-3 text-xs font-semibold", kind === k ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground")}>{label}</button>
              ))}
            </div>
            <div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX))} rows={5} required minLength={5} data-testid="input-fbo-feedback-message"
                placeholder={kind === "listing" ? "Which listing, and what's wrong?" : kind === "bug" ? "What were you doing, and what happened?" : "What's on your mind?"}
                className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm" />
              <p className="text-right font-code text-[10px] text-muted-foreground tabular">{message.length}/{FEEDBACK_MAX}</p>
            </div>
            <p className="text-xs text-muted-foreground">Sending as {email}, so we can reply.</p>
            <input value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" name="website" />
            {send.isError && <p className="text-sm text-destructive" data-testid="text-fbo-feedback-error">{(send.error as Error).message}</p>}
            <button type="submit" disabled={send.isPending || message.trim().length < 5} data-testid="button-fbo-feedback-send"
              className="h-11 w-full rounded-full taxi-sign text-sm font-semibold disabled:opacity-50">{send.isPending ? "Sending…" : "Send feedback"}</button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
