import { WRIGHT_NAME, WRIGHT_SEATS } from "@shared/club";
import { cn } from "@/lib/utils";

/** 1903 Wright Flyer in side view: canard elevator forward, braced biplane wings, twin rudders aft. */
export function WrightFlyer({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 26" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* wings */}
      <path d="M16 6.5 H50" strokeWidth="2.2" />
      <path d="M16 17.5 H50" strokeWidth="2.2" />
      {/* struts and bracing */}
      {[18, 25, 33, 41, 48].map((x) => <path key={x} d={`M${x} 6.5 V17.5`} strokeWidth="0.9" />)}
      <path d="M18 6.5 L25 17.5 M25 6.5 L18 17.5 M41 6.5 L48 17.5 M48 6.5 L41 17.5" strokeWidth="0.5" opacity="0.7" />
      {/* canard elevator on outriggers */}
      <path d="M3 9.5 H10 M3 13 H10" strokeWidth="1.6" />
      <path d="M6.5 9.5 V13 M10 11.2 L18 6.5 M10 11.2 L18 17.5" strokeWidth="0.8" />
      {/* twin rudders on booms */}
      <path d="M50 9.5 L56 10 M50 15 L56 14" strokeWidth="0.8" />
      <rect x="56" y="7.5" width="2.6" height="9" rx="0.4" strokeWidth="1.2" />
      {/* pilot and propeller hint */}
      <circle cx="31" cy="15.2" r="1.4" fill="currentColor" stroke="none" />
      <path d="M44 9.2 V14.8" strokeWidth="1.4" />
      {/* skids */}
      <path d="M12 21.5 Q22 23 30 21.5 M18 17.5 L19 21.7 M27 17.5 L27 21.9" strokeWidth="0.9" />
    </svg>
  );
}

/** Compact inline chip, e.g. on leaderboard rows. */
export function WrightChip({ no, className }: { no: number | null | undefined; className?: string }) {
  if (!no) return null;
  return (
    <span title={`${WRIGHT_NAME}, founding member No. ${no}`} data-testid="chip-wright"
      className={cn("inline-flex items-center gap-1 rounded-full border border-[#B8893B]/50 bg-[#F6EBD3] px-2 py-0.5 text-[11px] font-semibold text-[#5A3E16] dark:bg-[#2A2118] dark:text-[#E9C77E] dark:border-[#B8893B]/40", className)}>
      <WrightFlyer className="h-3 w-6" />Wright Club No. {no}
    </span>
  );
}

/** Full founding-member card for the Logbook and crew profiles. */
export function WrightCard({ no, name }: { no: number; name?: string }) {
  return (
    <section data-testid="card-wright" className="relative overflow-hidden rounded-2xl border border-[#B8893B]/40 p-4 text-[#F3E3BF]"
      style={{ background: "radial-gradient(120% 140% at 100% 0%, #5A4220 0%, #2A2118 55%, #1A140E 100%)" }}>
      <div className="flex items-start gap-4">
        <div className="relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full border-2 border-[#C99A45] bg-[#1A140E] shadow-[inset_0_0_0_4px_#2A2118,inset_0_0_0_5px_#C99A4566]">
          <span className="font-code text-[22px] font-bold leading-none text-[#E9C77E] tabular" data-testid="text-wright-no">{no}</span>
          <span className="absolute bottom-2 font-code text-[7px] tracking-[0.2em] text-[#C99A45]">OF {WRIGHT_SEATS}</span>
        </div>
        <div className="min-w-0">
          <p className="font-code text-[10px] tracking-[0.25em] text-[#C99A45]">FOUNDING MEMBER · KITTY HAWK 1903</p>
          <p className="mt-1 text-base font-semibold leading-snug text-white">{WRIGHT_NAME}</p>
          <p className="mt-0.5 text-xs text-[#F3E3BF]/75">{name ? `${name} was` : "You were"} No. {no} of the first {WRIGHT_SEATS} crews to sign up for Wheelsdown.</p>
        </div>
      </div>
      <WrightFlyer className="pointer-events-none absolute -bottom-1 right-2 h-10 w-24 text-[#C99A45]/35" />
    </section>
  );
}
