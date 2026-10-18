// Shared bits for the landing-page features (Layover Today, Crew Up, Rate a spot, My Crew, Crew Lounge).
import type { ReactNode } from "react";
import { useAdminOnly, usePreviewState } from "@/lib/experience";
import NotFound from "@/pages/not-found";

/** Before launch, members get the same Not found page as an unknown address (the server answers 404 too). */
export function PreviewGate({ children }: { children: ReactNode }) {
  const { on, ready } = usePreviewState();
  if (!ready) return null;
  if (!on) return <NotFound />;
  return <>{children}</>;
}

/** "Admins only" marker, shown only while the features are still hidden from members. */
export function PreviewBadge({ label = "Preview · admins only" }: { label?: string }) {
  if (!useAdminOnly()) return null;
  return <span className="inline-flex items-center rounded-full border border-dashed border-primary/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary" data-testid="badge-preview">{label}</span>;
}

/** "400: {"message":"..."}" → the message. */
export const errMsg = (e: unknown) => {
  const s = String((e as Error)?.message || e || "");
  const m = s.match(/\{.*\}$/);
  if (m) { try { return (JSON.parse(m[0]) as { message?: string }).message || s; } catch { /* fall through */ } }
  return s.replace(/^\d{3}:\s*/, "");
};

export const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
export const left = (ms: number) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60), r = m % 60;
  return r && h < 4 ? `${h} h ${r} min left` : `${h} h left`;
};
