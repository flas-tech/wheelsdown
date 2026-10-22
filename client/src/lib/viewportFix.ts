// Keeps the bottom tab bar on the bottom of the screen on iPhone, especially in the home-screen app.
//
// Problems we work around (iOS 26):
//  - After the keyboard closes, iOS sometimes leaves the viewport short (the old keyboard height), so anything fixed
//    to bottom:0 floats partway up the screen until the next real re-layout.
//  - While a page is scrolling (momentum, the rubber-band bounce at the top/bottom, Safari's toolbar collapsing) the
//    viewport numbers are briefly wrong. Correcting the bar from those numbers is what made it jump while scrolling
//    (crew feedback, 1.11), so the bar is never moved during a scroll: we measure only once scrolling has settled.
//
// What we do:
//  1. mark <html> with .kb-open while someone is typing, so the tab bar steps aside (like native iOS apps);
//  2. nudge the page to re-layout when the keyboard closes;
//  3. once things are still, measure how far the visible bottom is below the layout bottom and shift the tab bar down
//     by it (CSS var --vv-shift). In Safari (not the home-screen app) this is only done right after the keyboard
//     closes; the rest of the time Safari's own toolbar handling is left alone.
// Add ?navdebug to the address to see the numbers on screen (for checking on a real iPhone).
const editable = (el: Element | null) => {
  if (!el) return false;
  const t = el.tagName;
  if (t === "TEXTAREA" || t === "SELECT" || (el as HTMLElement).isContentEditable) return true;
  if (t !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image"].includes((el as HTMLInputElement).type);
};

const SETTLE_MS = 220; // quiet time after the last scroll event before we trust the viewport again
const KB_WINDOW_MS = 2500; // Safari: how long after the keyboard closes we keep correcting

export function installViewportFix() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let raf = 0;
  let lastScroll = 0;
  let settleTimer = 0;
  let kbClosedAt = 0;
  let shift = 0;
  const standalone = (navigator as any).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  const tallest: Record<string, number> = {};
  const debug = /[?&#]navdebug\b/.test(location.search + location.hash);
  let dbg: HTMLDivElement | null = null;

  const bouncing = () => {
    const y = window.scrollY;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return y < 0 || y > max + 1 || (vv ? vv.offsetTop < -0.5 : false);
  };

  const measure = () => {
    raf = 0;
    const typing = editable(document.activeElement);
    // four-tab preview (html.wd-trip): only step the bar aside when the keyboard is really up. iOS ignores a focus()
    // that isn't from a tap, so the box can be focused with no keyboard, and the bar used to vanish (crew feedback, round 6)
    const kbUp = !root.classList.contains("wd-trip") || !vv || window.innerHeight - vv.height * vv.scale > 120;
    root.classList.toggle("kb-open", typing && kbUp);
    // never move the bar mid-scroll; look again once it settles
    if (performance.now() - lastScroll < SETTLE_MS || bouncing()) { settle(); return; }
    let next = 0;
    if (!typing && (!vv || Math.abs(vv.scale - 1) < 0.01)) {
      // visible bottom below the layout bottom: only trust it in the home-screen app, or just after the keyboard closed
      if (vv && (standalone || performance.now() - kbClosedAt < KB_WINDOW_MS)) {
        const gap = vv.offsetTop + vv.height - window.innerHeight;
        if (gap > 1 && gap < 600) next = Math.round(gap);
      }
      // Home-screen app: no browser toolbars, so the screen height in an orientation never legitimately shrinks.
      // iOS sometimes leaves BOTH viewports short after a keyboard or picker closes, so pin against the tallest
      // height seen (never taller than the screen itself).
      if (standalone) {
        const land = window.innerWidth > window.innerHeight;
        const o = land ? "l" : "p";
        const cap = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
        const h = window.innerHeight;
        if (h > (tallest[o] || 0)) tallest[o] = Math.min(h, cap || h);
        const gap = tallest[o] - h;
        if (gap > 1 && gap < 600 && gap > next) next = Math.round(gap);
      }
    }
    if (next !== shift) { shift = next; root.style.setProperty("--vv-shift", `${shift}px`); }
    if (dbg) dbg.textContent = `shift ${shift} · inner ${window.innerHeight} · vv ${vv ? `${Math.round(vv.height)}+${Math.round(vv.offsetTop)}` : "-"} · y ${Math.round(window.scrollY)} · ${standalone ? "app" : "safari"}`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
  const settle = () => { clearTimeout(settleTimer); settleTimer = window.setTimeout(schedule, SETTLE_MS); };
  const onScroll = () => { lastScroll = performance.now(); settle(); };

  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", () => {
    kbClosedAt = performance.now();
    schedule();
    // let iOS finish closing the keyboard, then force a re-layout and re-measure
    setTimeout(() => {
      if (editable(document.activeElement)) return;
      window.scrollTo(window.scrollX, window.scrollY);
      schedule();
    }, 120);
    setTimeout(schedule, 450);
  });
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", onScroll);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(schedule, 300));
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("pageshow", schedule);
  if (debug) {
    dbg = document.createElement("div");
    dbg.style.cssText = "position:fixed;top:calc(env(safe-area-inset-top) + 4px);left:4px;z-index:99999;font:11px/1.3 ui-monospace,monospace;background:rgba(0,0,0,.75);color:#fff;padding:3px 6px;border-radius:6px;pointer-events:none";
    document.body.appendChild(dbg);
  }
  schedule();
}
