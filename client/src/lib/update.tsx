// Keeps open copies of the app current. An iPhone home-screen shortcut resumes from memory instead of reloading, so
// it could run an old release for days. When the app comes back to the front (or every 15 minutes) it asks which
// release is live; if that changed, it reloads by itself, or offers an Update button while someone is typing.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { IS_STATIC, API_BASE } from "./queryClient";

const EVENT = "wheelsdown:update";
let base: string | null = null;
let ready = false;

const busy = () => {
  const a = document.activeElement as HTMLElement | null;
  const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  return typing || !!document.querySelector("[role=dialog]");
};

type Check = "current" | "update" | "offline";
async function check(): Promise<Check> {
  if (ready) return "update";
  try {
    const r = await fetch(`${API_BASE}/api/version`, { cache: "no-store" });
    if (!r.ok) return "offline";
    const { version } = (await r.json()) as { version?: string };
    if (!version) return "offline";
    if (!base) { base = version; return "current"; }
    if (version === base) return "current";
    ready = true;
    // coming back to the app: nothing is in progress, so just reload
    if (document.visibilityState === "visible" && !busy()) { window.location.reload(); return "update"; }
    window.dispatchEvent(new Event(EVENT));
    return "update";
  } catch { return "offline"; /* try again next time */ }
}

/** Logbook "Check for updates": asks the server which release is live; reloads if this copy is older. */
export async function checkForUpdate(): Promise<Check> {
  if (IS_STATIC) return "current";
  const r = await check();
  if (r === "update") window.location.reload();
  return r;
}

export function installUpdateCheck() {
  if (IS_STATIC) return; // the demo has no server
  void check();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (ready && !busy()) { window.location.reload(); return; }
    void check();
  });
  window.addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted) void check(); });
  window.addEventListener("focus", () => void check());
  setInterval(() => void check(), 15 * 60_000);
}

/** Small bar shown when a new release is out but the member is in the middle of something. */
export function UpdateBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(true);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[max(env(safe-area-inset-top),0.5rem)] print:hidden" role="status" data-testid="bar-update">
      <div className="flex items-center gap-3 rounded-full bg-[#0B1222] py-1.5 pl-4 pr-1.5 text-xs text-white shadow-lg">
        <span>New version ready</span>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 font-semibold text-[#0B1222]" data-testid="button-update-now">
          <RefreshCw className="h-3.5 w-3.5" />Update
        </button>
        <button type="button" onClick={() => setShow(false)} className="h-8 rounded-full px-2 text-white/70 hover:text-white" data-testid="button-update-later">Later</button>
      </div>
    </div>
  );
}
