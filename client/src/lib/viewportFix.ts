// Keeps the bottom tab bar on the bottom of the screen on iPhone, especially in the home-screen app.
// After the keyboard closes, iOS sometimes leaves the layout viewport short (the old keyboard height), so anything
// fixed to bottom:0 floats partway up the screen until the next real re-layout. We:
//  1. mark <html> with .kb-open while someone is typing, so the tab bar steps aside (like native iOS apps);
//  2. nudge the page to re-layout when the keyboard closes;
//  3. measure the gap between the visible screen's bottom and the layout bottom, and shift the tab bar down by it
//     (CSS var --vv-shift), so it can't stay stranded even if iOS doesn't re-layout.
const editable = (el: Element | null) => {
  if (!el) return false;
  const t = el.tagName;
  if (t === "TEXTAREA" || t === "SELECT" || (el as HTMLElement).isContentEditable) return true;
  if (t !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image"].includes((el as HTMLInputElement).type);
};

export function installViewportFix() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let raf = 0;
  const standalone = (navigator as any).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  const tallest: Record<string, number> = {};
  const measure = () => {
    raf = 0;
    const typing = editable(document.activeElement);
    root.classList.toggle("kb-open", typing);
    let shift = 0;
    // only when not typing and not pinch-zoomed: the visible bottom should be the layout bottom
    if (vv && !typing && Math.abs(vv.scale - 1) < 0.01) {
      const gap = vv.offsetTop + vv.height - window.innerHeight;
      if (gap > 1 && gap < 600) shift = Math.round(gap);
    }
    // Home-screen app: no browser toolbars, so the screen height in an orientation never legitimately shrinks.
    // iOS sometimes leaves BOTH the layout and visual viewport short after a keyboard or picker closes (so the
    // check above sees no gap) and the bar floats mid-screen. Pin it against the tallest height seen instead.
    if (standalone && !typing) {
      const o = window.innerWidth > window.innerHeight ? "l" : "p";
      const h = window.innerHeight;
      if (h > (tallest[o] || 0)) tallest[o] = h;
      const gap = tallest[o] - h;
      if (gap > 1 && gap < 600 && gap > shift) shift = Math.round(gap);
    }
    root.style.setProperty("--vv-shift", `${shift}px`);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", () => {
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
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  // re-check as the page scrolls too, so a stranded bar snaps back the moment you move
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(schedule, 300));
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("pageshow", schedule);
  schedule();
}
