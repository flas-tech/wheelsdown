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

// FBO QR links look like getwheelsdown.com/#/...?fbo=<slug>. Remembered for 30 days so a crew sign-up that started at an
// FBO's desk or lounge is counted for that FBO (no points, just a count on the FBO's dashboard).
const FBO_KEY = "wheelsdown-fbo-ref";
let arrivedFrom: string | null = null;
export function captureFboRef() {
  try {
    const url = new URL(window.location.href);
    const q = new URLSearchParams(url.hash.split("?")[1] || "");
    const raw = (url.searchParams.get("fbo") || q.get("fbo") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
    if (!raw) return;
    arrivedFrom = raw;
    localStorage.setItem(FBO_KEY, JSON.stringify({ slug: raw, at: Date.now(), join: q.get("join") === "1" || url.searchParams.get("join") === "1" }));
  } catch { /* ignore */ }
}
export function pendingFbo(): string | undefined {
  try { const v = JSON.parse(localStorage.getItem(FBO_KEY) || "null"); if (v?.slug && Date.now() - v.at < DAYS * 86400_000) return v.slug; } catch { /* ignore */ }
  return undefined;
}
/** The FBO this visit came from (this page load only), and whether the link asked to open sign-up. */
export function fboArrival(): { slug: string; join: boolean } | null {
  if (!arrivedFrom) return null;
  try { const v = JSON.parse(localStorage.getItem(FBO_KEY) || "null"); return { slug: arrivedFrom, join: !!v?.join }; } catch { return { slug: arrivedFrom, join: false }; }
}
export function clearFboRef() { try { localStorage.removeItem(FBO_KEY); } catch { /* ignore */ } }
