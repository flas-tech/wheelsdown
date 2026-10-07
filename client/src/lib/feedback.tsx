import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageSquarePlus, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { FEEDBACK_KINDS, FEEDBACK_MAX, type FeedbackKind } from "@shared/feedback";

export function FeedbackDialog({ open, onOpenChange, defaultKind = "idea" }: { open: boolean; onOpenChange: (o: boolean) => void; defaultKind?: FeedbackKind }) {
  const { me } = useAuth();
  const [kind, setKind] = useState<FeedbackKind>(defaultKind);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [hp, setHp] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/feedback", { kind, message, contact: me ? "" : contact, page: window.location.hash.replace(/^#/, "") || "/", website: hp })).json(),
    onSuccess: () => { setSent(true); setMessage(""); setContact(""); },
  });
  const close = (o: boolean) => { onOpenChange(o); if (!o) setTimeout(() => { setSent(false); send.reset(); }, 200); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md" data-testid="dialog-feedback">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>Ideas, bugs, a listing that's wrong. It goes straight to the Wheelsdown team and isn't posted publicly.</DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center" data-testid="text-feedback-sent">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/15"><Check className="h-6 w-6 text-primary" /></span>
            <p className="font-semibold">Thanks, got it.</p>
            <p className="text-sm text-muted-foreground">We read every message.</p>
            <button onClick={() => close(false)} className="mt-2 h-10 rounded-full taxi-sign px-5 text-sm font-semibold" data-testid="button-feedback-done">Done</button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type of feedback">
              {FEEDBACK_KINDS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} data-testid={`chip-feedback-${k}`}
                  className={cn("h-9 rounded-full border px-3 text-xs font-semibold", kind === k ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground")}>{label}</button>
              ))}
            </div>
            <div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX))} rows={5} required minLength={5} data-testid="input-feedback-message"
                placeholder={kind === "listing" ? "Which listing, at which airport, and what's wrong?" : kind === "bug" ? "What were you doing, and what happened?" : "What's on your mind?"}
                className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm" />
              <p className="text-right font-code text-[10px] text-muted-foreground tabular">{message.length}/{FEEDBACK_MAX}</p>
            </div>
            {me ? (
              <p className="text-xs text-muted-foreground">Sending as {me.displayName} (@{me.handle}), so we can follow up.</p>
            ) : (
              <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} placeholder="Email (optional, if you'd like a reply)" type="email" data-testid="input-feedback-contact"
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base sm:text-sm" />
            )}
            <input value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" name="website" />
            {send.isError && <p className="text-sm text-destructive" data-testid="text-feedback-error">{(send.error as Error).message.replace(/^\d+:\s*/, "")}</p>}
            <button type="submit" disabled={send.isPending || message.trim().length < 5} data-testid="button-feedback-send"
              className="h-11 w-full rounded-full taxi-sign text-sm font-semibold disabled:opacity-50">{send.isPending ? "Sending…" : "Send feedback"}</button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Text link that opens the feedback form (footer). */
export function FeedbackLink({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (<>
    <button type="button" onClick={() => setOpen(true)} className={className} data-testid="link-feedback">Send feedback</button>
    <FeedbackDialog open={open} onOpenChange={setOpen} />
  </>);
}

/** Card for the Logbook. */
export function FeedbackCard() {
  const [open, setOpen] = useState(false);
  return (<>
    <button type="button" onClick={() => setOpen(true)} data-testid="card-feedback" className="flex w-full items-center gap-3 rounded-2xl border border-card-border bg-card p-4 text-left hover-elevate">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><MessageSquarePlus className="h-5 w-5 text-primary" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Send feedback</span><span className="block text-xs text-muted-foreground">Ideas, bugs or a listing that's wrong. Goes straight to the team.</span></span>
    </button>
    <FeedbackDialog open={open} onOpenChange={setOpen} />
  </>);
}
