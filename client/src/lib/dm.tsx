// Private messages on the client: is it open for me, this device's keys, unread count, and starting a conversation.
// The encryption itself is in lib/dmCrypto.ts.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MessageCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { dmSupported, loadDevice, makeKeys, rememberDevice, forgetDevice } from "@/lib/dmCrypto";
import type { DmConfig, MyDmDevice } from "@shared/dm";

export function useDmConfig() {
  const { me } = useAuth();
  return useQuery<DmConfig>({ queryKey: ["/api/dm/config", me?.id ?? 0], queryFn: async () => (await apiRequest("GET", "/api/dm/config")).json(), staleTime: 60_000, retry: false });
}
export function useDmOn() { const { me } = useAuth(); const c = useDmConfig(); return !!me && !!c.data?.available; }

/** A short name for this device, so you can tell your devices apart in Settings. */
function deviceLabel() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Browser";
  const app = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone ? "home-screen app" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "browser";
  return `${kind} · ${app}`;
}

let pending: Promise<Awaited<ReturnType<typeof loadDevice>> | null> | null = null;
/** This device's keys, registering a new device (and new keys) if it has none or the server retired it. */
export function ensureDevice(userId: number) {
  if (!dmSupported()) return Promise.resolve(null);
  pending ||= (async () => {
    try {
      let d = await loadDevice(userId);
      if (d) {
        const r = await (await apiRequest("GET", `/api/dm/devices?current=${d.deviceId}`)).json() as { devices: MyDmDevice[] };
        if (!r.devices.some((x) => x.id === d!.deviceId)) { await forgetDevice(userId); d = undefined; }
      }
      if (!d) {
        const k = await makeKeys();
        const r = await (await apiRequest("POST", "/api/dm/devices", { encPub: k.encPub, sigPub: k.sigPub, label: deviceLabel() })).json() as { id: number };
        await rememberDevice(userId, r.id, k);
        d = await loadDevice(userId);
      }
      return d || null;
    } finally { setTimeout(() => { pending = null; }, 0); }
  })();
  return pending;
}

export function useDmDevice() {
  const { me } = useAuth();
  const on = useDmOn();
  const [state, setState] = useState<{ device: Awaited<ReturnType<typeof loadDevice>> | null; ready: boolean; error: string }>({ device: null, ready: false, error: "" });
  useEffect(() => {
    if (!on || !me) return;
    let live = true;
    ensureDevice(me.id).then((device) => live && setState({ device, ready: true, error: device ? "" : "This browser can't do private messages." }))
      .catch((e) => live && setState({ device: null, ready: true, error: String(e?.message || e) }));
    return () => { live = false; };
  }, [on, me?.id]); // eslint-disable-line
  return state;
}

/** Mounted in the app shell: sets up this device's keys early, so crew can send you messages before you open Messages. */
export function DmKeyHost() {
  const { me } = useAuth();
  const on = useDmOn();
  useEffect(() => {
    if (!on || !me) return;
    const t = setTimeout(() => { void ensureDevice(me.id).catch(() => {}); }, 2500);
    return () => clearTimeout(t);
  }, [on, me?.id]); // eslint-disable-line
  return null;
}

export function useDmUnread() {
  const on = useDmOn();
  return useQuery<{ unread: number }>({ queryKey: ["/api/dm/unread"], enabled: on, staleTime: 15_000, refetchInterval: 60_000, retry: false }).data?.unread || 0;
}

/** Open (or start) a direct conversation, or the thread on a Crew Up plan. */
export function useOpenThread() {
  const [, go] = useLocation();
  return async (what: { userId: number } | { meetupId: number }) => {
    const r = "userId" in what
      ? await (await apiRequest("POST", "/api/dm/direct", { userId: what.userId })).json()
      : await (await apiRequest("POST", `/api/dm/crewup/${what.meetupId}`, {})).json();
    queryClient.invalidateQueries({ queryKey: ["/api/dm/conversations"] });
    go(`/messages/${r.id}`);
  };
}

/** "Messages" on a Crew Up plan, or "Message" next to someone in your crew. Hidden until messages are open for you. */
export function ThreadButton({ meetupId, userId, label, className, ariaLabel, testId }: { meetupId?: number; userId?: number; label?: string; className?: string; ariaLabel?: string; testId?: string }) {
  const on = useDmOn();
  const open = useOpenThread();
  const [busy, setBusy] = useState(false);
  if (!on) return null;
  return (
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await open(meetupId ? { meetupId } : { userId: userId! }); } catch (e: any) { alert(String(e?.message || e).replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1")); } finally { setBusy(false); } }}
      className={className ?? "inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate disabled:opacity-50"}
      aria-label={ariaLabel} data-testid={testId ?? (meetupId ? `button-thread-${meetupId}` : `button-message-${userId}`)}>
      <MessageCircle className="h-3.5 w-3.5" />{label ?? (meetupId ? "Messages" : "Message")}
    </button>
  );
}
