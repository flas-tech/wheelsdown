// Red dots on the bottom tabs (feedback #51), so members open the tab that has something waiting:
// Logbook: notifications or profile gaps (NoticeDot). My Crew: crew requests waiting for you.
// Crew Up: a plan from your crew posted since you last opened Crew Up on this device.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { usePreview } from "@/lib/experience";
import { useMyCrew } from "@/lib/mycrew";
import { NoticeDot } from "@/lib/notices";

const KEY = "wd-crewup-seen";
const EVENT = "wheelsdown:crewup-seen";
const readSeen = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };

/** Called when Crew Up has loaded: everything posted up to now counts as seen. */
export function markCrewUpSeen() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}

function useCrewUpNew() {
  const on = usePreview();
  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    const f = () => setSeen(readSeen());
    window.addEventListener(EVENT, f); window.addEventListener("storage", f);
    return () => { window.removeEventListener(EVENT, f); window.removeEventListener("storage", f); };
  }, []);
  const { data } = useQuery<{ latest: number; count: number }>({ queryKey: ["/api/preview/crewup-latest"], enabled: on, staleTime: 30_000, refetchInterval: 120_000, retry: false });
  return !!data?.latest && data.latest > seen;
}

const Dot = ({ label, testId }: { label: string; testId: string }) => (
  <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" role="status" aria-label={label} title={label} data-testid={testId} />
);

function CrewDot() {
  const n = useMyCrew().data?.incoming.length || 0;
  return n ? <Dot label={`${n} crew request${n === 1 ? "" : "s"} waiting`} testId="dot-mycrew" /> : null;
}
function CrewUpDot() {
  const [loc] = useLocation();
  const fresh = useCrewUpNew();
  return fresh && loc !== "/meetup" ? <Dot label="New Crew Up plans from your crew" testId="dot-crewup" /> : null;
}

/** Crew tab in the four-tab bar: crew requests waiting or new Crew Up plans. */
function CrewTabDot() {
  const n = useMyCrew().data?.incoming.length || 0;
  const [loc] = useLocation();
  const fresh = useCrewUpNew();
  if (n) return <Dot label={`${n} crew request${n === 1 ? "" : "s"} waiting`} testId="dot-crew" />;
  return fresh && loc !== "/meetup" ? <Dot label="New Crew Up plans from your crew" testId="dot-crew" /> : null;
}

/** The dot for a tab, if that tab has one. */
export function TabDot({ href }: { href: string }) {
  if (href === "crew") return <CrewTabDot />;
  if (href === "/me") return <NoticeDot />;
  if (href === "/mycrew") return <CrewDot />;
  if (href === "/meetup") return <CrewUpDot />;
  return null;
}
