// Sends browser errors to the admin error log. Server-side failures (5xx) are already logged by the server,
// so API errors are skipped here; this catches crashes and broken scripts on members' phones.
import { IS_STATIC, API_BASE } from "./queryClient";

let sent = 0;
const seen = new Set<string>();
export function reportClientError(message: string, stack = "", kind = "error") {
  if (IS_STATIC || sent >= 10) return; // the demo has no server; never flood from one page
  const msg = String(message || "").slice(0, 500);
  if (!msg || /^\d{3}: /.test(msg) || seen.has(msg)) return;
  seen.add(msg); sent++;
  const body = JSON.stringify({ message: msg, stack: String(stack || "").slice(0, 3000), page: location.hash || "/", kind, ua: navigator.userAgent });
  try {
    if (navigator.sendBeacon?.(`${API_BASE}/api/client-errors`, new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through */ }
  fetch(`${API_BASE}/api/client-errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}
export function installErrorReporting() {
  window.addEventListener("error", (e) => reportClientError(e.message, e.error?.stack || `${e.filename || ""}:${e.lineno || ""}`, "error"));
  window.addEventListener("unhandledrejection", (e) => {
    const r: any = e.reason;
    reportClientError(r?.message || String(r), r?.stack || "", "promise");
  });
}
