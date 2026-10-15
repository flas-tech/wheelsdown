// The app's version number, so members can tell they're on the latest release.
// It goes up by one with every release automatically: Version 1.<newest What's new id>, dated with that release.
import { useState } from "react";
import { RefreshCw, CheckCircle2, Sparkles } from "lucide-react";
import { RELEASES, LATEST_RELEASE, openWhatsNew } from "./whatsNew";
import { checkForUpdate } from "./update";

export const APP_VERSION = `1.${LATEST_RELEASE}`;
export const APP_VERSION_DATE = RELEASES[0].date;

/** Footer: "Version 1.8 · October 15, 2026", opens the release notes. */
export function VersionLine({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => openWhatsNew()} className={`hover:text-foreground ${className}`} data-testid="link-footer-version" title="See what's new">
      Version {APP_VERSION} · {APP_VERSION_DATE}
    </button>
  );
}

/** Logbook card: version, date, Check for updates, What's new. */
export function VersionCard() {
  const [state, setState] = useState<"idle" | "busy" | "current" | "update" | "offline">("idle");
  const run = async () => { setState("busy"); setState(await checkForUpdate()); };
  const note = state === "current" ? "You're on the latest version." : state === "update" ? "Updating to the newest version…" : state === "offline" ? "Couldn't check. You may be offline. Try again in a moment." : "Updates install by themselves when you reopen the app.";
  return (
    <section className="rounded-2xl border border-card-border bg-card px-4 py-3" data-testid="card-version">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Wheelsdown <span data-testid="text-app-version">Version {APP_VERSION}</span></p>
          <p className="text-xs text-muted-foreground">Released {APP_VERSION_DATE}</p>
        </div>
        <button type="button" onClick={run} disabled={state === "busy" || state === "update"} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate disabled:opacity-60" data-testid="button-check-update">
          {state === "current" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <RefreshCw className={`h-3.5 w-3.5 ${state === "busy" || state === "update" ? "animate-spin" : ""}`} />}
          {state === "current" ? "Up to date" : "Check for updates"}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" role="status" data-testid="text-update-status">{note}</p>
        <button type="button" onClick={() => openWhatsNew()} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-foreground underline underline-offset-2" data-testid="button-version-whats-new"><Sparkles className="h-3 w-3" />What's new</button>
      </div>
    </section>
  );
}
