import { useState } from "react";
import { Check, Copy, MessageCircle, Share2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IS_STATIC } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { trackShare } from "@/lib/metrics";
import { POINTS } from "@shared/tiers";

const SITE = "https://getwheelsdown.com";
/** Public link to a page. The demo build shares its own address; the live site always shares getwheelsdown.com. */
export function shareUrl(path = "/") {
  const base = IS_STATIC ? window.location.href.split("#")[0] : SITE + "/";
  return path === "/" ? base : `${base}#${path}`;
}
const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
/** Messages link with the text filled in. iOS and macOS use "&body=", Android and others "?body=". */
export const smsHref = (body: string) => `sms:${isApple() ? "&" : "?"}body=${encodeURIComponent(body)}`;

type Props = { title?: string; message?: string; path?: string; /** full link to share instead of a page path (invite links) */ url?: string };
const DEFAULT_MSG = "Check out Wheelsdown, a crew-vetted layover guide. Search your route for places to eat and things to do near the airport:";

/** Share dialog: text a link, open the phone's share sheet, or copy the link. */
export function ShareDialog({ open, onOpenChange, title = "Share Wheelsdown", message = DEFAULT_MSG, path = "/", url: fixedUrl, note }: Props & { open: boolean; onOpenChange: (o: boolean) => void; note?: string }) {
  const [copied, setCopied] = useState(false);
  const url = fixedUrl || shareUrl(path);
  const body = `${message} ${url}`;
  const what = path === "/" ? "site" : "spot";
  const canNative = typeof navigator !== "undefined" && !!navigator.share;
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); }
    catch { const t = document.createElement("textarea"); t.value = body; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    trackShare(what); setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const native = async () => { try { await navigator.share({ title: "Wheelsdown", text: message, url }); trackShare(what); onOpenChange(false); } catch { /* cancelled */ } };
  const row = "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 h-14 text-left text-sm font-semibold hover-elevate";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="dialog-share">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{note || "Send it to your crew. The link opens right in their browser, no app needed."}</DialogDescription>
        </DialogHeader>
        <p className="rounded-xl bg-muted/60 p-3 text-sm" data-testid="text-share-message">{message} <span className="break-all text-primary">{url}</span></p>
        <div className="space-y-2">
          <a href={smsHref(body)} className={cn(row, "taxi-sign border-transparent")} data-testid="button-share-text" onClick={() => { trackShare(what); setTimeout(() => onOpenChange(false), 300); }}>
            <MessageCircle className="h-5 w-5" />Text it
          </a>
          {canNative && <button onClick={native} className={row} data-testid="button-share-native"><Upload className="h-5 w-5 text-primary" />More ways to share</button>}
          <button onClick={copy} className={row} data-testid="button-share-copy">
            {copied ? <Check className="h-5 w-5 text-emerald-600" /> : <Copy className="h-5 w-5 text-primary" />}{copied ? "Copied" : "Copy link and message"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Round header button. */
export function ShareButton({ className, ...p }: Props & { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Share Wheelsdown" data-testid="button-share" className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover-elevate", className)}>
        <Share2 className="h-[18px] w-[18px]" />
      </button>
      <ShareDialog open={open} onOpenChange={setOpen} {...p} />
    </>
  );
}

/** Your personal invite link: opens the site and remembers who sent it until the person signs up. */
export function inviteUrl(refId: number) {
  const base = IS_STATIC ? window.location.href.split("#")[0].split("?")[0] : SITE + "/";
  return `${base}?ref=${refId}`;
}

/** Inline call to action on the Logbook. Points are only awarded once the invited person creates an account. */
export function InviteCard({ refId, referrals = 0 }: { refId?: number; referrals?: number }) {
  const [open, setOpen] = useState(false);
  const pts = POINTS.referral;
  return (
    <section className="flex items-center gap-3 rounded-2xl border border-card-border bg-card p-4" data-testid="card-invite">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15"><MessageCircle className="h-5 w-5 text-primary" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Invite your crew</p>
        <p className="text-xs text-muted-foreground" data-testid="text-invite-sub">{refId
          ? <>Earn <span className="font-semibold text-foreground">{pts} pts</span> for each person who signs up with your link.{referrals ? ` ${referrals} joined so far.` : ""}</>
          : "More crews means better picks on every layover."}</p>
      </div>
      <button onClick={() => setOpen(true)} className="h-10 shrink-0 rounded-full taxi-sign px-4 text-sm font-semibold hover-elevate" data-testid="button-invite">Text a link</button>
      <ShareDialog open={open} onOpenChange={setOpen} title="Invite your crew" url={refId ? inviteUrl(refId) : undefined}
        note={refId ? `This link is yours. When someone creates an account with it, you get ${pts} points. Nothing is awarded for clicks alone.` : undefined} />
    </section>
  );
}
