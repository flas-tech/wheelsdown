// Invite links look like getwheelsdown.com/?ref=<member id>. The id is remembered in this browser for 30 days so the
// person can look around first and sign up later; it's sent once with the sign-up and then forgotten.
const KEY = "wheelsdown-ref";
const DAYS = 30;

export function captureRef() {
  try {
    const url = new URL(window.location.href);
    const fromHash = new URLSearchParams(url.hash.split("?")[1] || "").get("ref");
    const raw = url.searchParams.get("ref") || fromHash;
    const id = Number(raw);
    if (raw && Number.isInteger(id) && id > 0) {
      localStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() }));
      url.searchParams.delete("ref");
      window.history.replaceState(null, "", url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash.replace(/[?&]ref=\d+/, ""));
    }
  } catch { /* storage blocked: no referral, nothing else breaks */ }
}
export function pendingRef(): number | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && v.id > 0 && Date.now() - v.at < DAYS * 86400_000) return v.id;
  } catch { /* ignore */ }
  return undefined;
}
export function clearRef() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
