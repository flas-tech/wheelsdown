// The standard footer (legal links, FAQ, tour, feedback, version), shared by the app shell and the home screen.
import { Link } from "wouter";
import { Shield } from "lucide-react";
import { FeedbackLink } from "@/lib/feedback";
import { TourLink } from "@/lib/tour";
import { VersionLine } from "@/lib/version";
import { IS_STATIC } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("print:hidden space-y-3 text-xs text-muted-foreground", className)} data-testid="site-footer">
      <div className="flex items-center justify-between gap-3">
        <p>{IS_STATIC ? "Demo build: sample data, and your additions are saved only in this browser." : "Crew-sourced. Verify hours and prices before you go."}</p>
        <Link href="/admin" data-testid="link-admin" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"><Shield className="h-3.5 w-3.5" />Admin</Link>
      </div>
      <nav className="flex flex-wrap gap-x-4 gap-y-1" data-testid="nav-legal">
        <Link href="/about" className="hover:text-foreground">About & Advertise</Link>
        <Link href="/faq" className="hover:text-foreground" data-testid="link-footer-faq">FAQ</Link>
        <Link href="/guidelines" className="hover:text-foreground">Guidelines</Link>
        <Link href="/terms" className="hover:text-foreground">Terms</Link>
        <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
        <TourLink className="hover:text-foreground" />
        <FeedbackLink className="font-semibold text-foreground hover:text-primary" />
      </nav>
      <VersionLine className="text-[11px] text-muted-foreground/80" />
    </footer>
  );
}
