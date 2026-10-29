// Push notifications on this device: setup, the Settings card, and the app-icon badge.
// iPhone/iPad: only in the home-screen app (iOS 16.4+), and the permission prompt must come straight from a tap.
// Server side and payload format: server/push.ts. Background script: client/public/sw.js (notifications only, no caching).
import { useLayoverTools } from "@/lib/experience";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BellOff, BellRing, Loader2, Moon, Share, SquarePlus } from "lucide-react";
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs, type PushConfig } from "@shared/push";
import { apiRequest, queryClient, IS_STATIC } from "@/lib/queryClient";
import { useDmOn } from "@/lib/dm";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SW_URL = "/sw.js";
const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");

export const isIOS = () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
export const isStandalone = () => typeof window !== "undefined" && ((navigator as any).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches);
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** What this device can do right now. */
export type DeviceState = "unsupported" | "install" | "denied" | "off" | "on";

export function usePushConfig() {
  const { me } = useAuth();
  return useQuery<PushConfig>({ queryKey: ["/api/push/config"], enabled: !!me && !IS_STATIC, staleTime: 60_000, retry: false });
}

const b64ToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const register = () => navigator.serviceWorker.register(SW_URL, { scope: "/" });
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };

async function currentSub(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) || null;
}

export function useDeviceState(): [DeviceState, () => Promise<void>, boolean] {
  const [s, setS] = useState<DeviceState>("off");
  const [ready, setReady] = useState(false);
  const check = async () => {
    try {
      // iPhone/iPad Safari tab: no notifications until it's opened from the home screen
      if (isIOS() && !isStandalone()) { setS("install"); return; }
      if (!supported()) { setS("unsupported"); return; }
      if (Notification.permission === "denied") { setS("denied"); return; }
      setS((await currentSub().catch(() => null)) ? "on" : "off");
    } finally { setReady(true); }
  };
  useEffect(() => { void check(); }, []);
  return [s, check, ready];
}

/** Call straight from a tap. Asks iOS/Android for permission, then signs this device up with the server. */
export async function enablePush(publicKey: string) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for Wheelsdown. Turn them on in Settings > Notifications > Wheelsdown." : "Notifications weren't allowed.");
  const reg = (await navigator.serviceWorker.getRegistration("/")) || (await register());
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  const j = sub.toJSON();
  await apiRequest("POST", "/api/push/subscribe", { endpoint: j.endpoint, keys: j.keys, tz: zone() });
}

export async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  await apiRequest("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * Mounted once in the app shell. For members who have push available: registers the background script (so turning
 * notifications on is instant), re-sends this device's subscription if it changed, follows taps on a notification when
 * the app is already open, and keeps the red number on the home-screen icon in step with unread notifications.
 */
export function PushHost({ unread }: { unread: number }) {
  const { data } = usePushConfig();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!data?.available || !supported()) return;
    register().then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        const j = sub.toJSON();
        apiRequest("POST", "/api/push/subscribe", { endpoint: j.endpoint, keys: j.keys, tz: zone() }).catch(() => {});
      }
    }).catch(() => {});
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "wd-open" && typeof e.data.url === "string") {
        try { const u = new URL(e.data.url); if (u.origin === location.origin) { location.hash = u.hash || "#/"; setTick((t) => t + 1); } } catch { /* ignore */ }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [data?.available]);
  useEffect(() => {
    const n = navigator as any;
    if (!isStandalone() || typeof n.setAppBadge !== "function") return;
    (unread > 0 ? n.setAppBadge(unread) : n.clearAppBadge?.())?.catch?.(() => {});
  }, [unread]);
  return null;
}

const onAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** Apple and Android steps for the home-screen app and notifications. Current phone is listed first. */
export function HomeScreenSteps({ compact }: { compact?: boolean }) {
  const ios = isIOS();
  const android = onAndroid();
  const blocks = [
    { key: "apple", mine: ios, title: "iPhone and iPad", steps: [
      "Open Wheelsdown in Safari.",
      "Tap Share, then Add to Home Screen, then Add.",
      "Open it from the new icon. On iPhone, notifications only work from that icon, not a Safari tab.",
      "Tap the gear on Logbook, then Turn on notifications, then Allow.",
    ] },
    { key: "android", mine: android, title: "Android", steps: [
      "Open Wheelsdown in Chrome.",
      "Tap the menu (three dots), then Install app or Add to Home screen.",
      "Open it from the new icon.",
      "Tap the gear on Logbook, then Turn on notifications, then Allow.",
    ] },
  ].sort((a, b) => Number(b.mine) - Number(a.mine));
  return (
    <div className="space-y-2 text-left" data-testid="list-home-screen-steps">
      {blocks.map((b) => (
        <div key={b.key} className={cn("rounded-xl border p-2.5", b.mine ? "border-primary/50 bg-primary/10" : "border-border bg-muted/50")}>
          <p className="text-[11px] font-semibold text-foreground">{b.title}{b.mine ? " · this phone" : ""}</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] leading-snug text-muted-foreground">
            {b.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      ))}
      {!compact && <p className="text-[11px] text-muted-foreground">Notifications still arrive when the app is closed.</p>}
    </div>
  );
}

/** Shown until push is open to this account, so the signup tour has somewhere to land. */
function InstallGuide() {
  return (
    <section id="notifications" className="scroll-mt-24 space-y-3 rounded-2xl border border-card-border bg-card p-4" data-testid="section-install-guide">
      <h2 className="text-sm font-semibold">Home screen and notifications</h2>
      <p className="text-xs text-muted-foreground">Add Wheelsdown to your home screen, then turn notifications on from the gear on your Logbook. Crew requests and Crew Up plans show up even when the app is closed.</p>
      <HomeScreenSteps compact />
      <p className="text-[11px] text-muted-foreground">The Turn on button appears on this page when notifications are open for your account.</p>
    </section>
  );
}

const ROWS: { key: keyof NotifyPrefs; title: string; body: string }[] = [
  { key: "crewRequests", title: "Crew requests", body: "Someone wants to add you, or accepts your request." },
  { key: "crewUp", title: "Crew Up plans", body: "Someone in My Crew posts plans at an airport." },
  { key: "crewUpJoins", title: "Who's in", body: "A crew member says they're in on your Crew Up." },
  { key: "messages", title: "Messages", body: "A private message, or a reply in a Crew Up thread. It never shows the text." },
  { key: "delays", title: "Delays and ground stops", body: "FAA ground stops, delay programs and closures at an airport on your trip sheet today or tomorrow." },
  { key: "team", title: "From Wheelsdown", body: "Replies to your feedback and notes from the team." },
];
const hourLabel = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);

/** Settings > Notifications. */
export function NotificationSettings() {
  const { me } = useAuth();
  const dmOn = useDmOn();
  const delaysOn = useLayoverTools().on;
  const { toast } = useToast();
  const cfg = usePushConfig();
  const [state, recheck] = useDeviceState();
  const [busy, setBusy] = useState(false);
  const prefs = cfg.data?.prefs || DEFAULT_NOTIFY_PREFS;
  const save = useMutation({
    mutationFn: async (p: Partial<NotifyPrefs>) => (await apiRequest("PUT", "/api/push/prefs", p)).json(),
    onMutate: (p) => { queryClient.setQueryData<PushConfig>(["/api/push/config"], (c) => c && { ...c, prefs: { ...c.prefs, ...p } }); },
    onSuccess: (r: { prefs: NotifyPrefs }) => queryClient.setQueryData<PushConfig>(["/api/push/config"], (c) => c && { ...c, prefs: r.prefs }),
    onError: (e) => { toast({ title: "Couldn't save", description: errText(e), variant: "destructive" }); queryClient.invalidateQueries({ queryKey: ["/api/push/config"] }); },
  });
  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/push/test")).json(),
    onSuccess: (r: { sent: number; failed: number }) => toast({ title: r.sent ? "Test sent" : "Didn't arrive", description: r.sent ? `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}. It should show up in a few seconds.` : "None of your devices took it. Turn notifications off and on again on this device." }),
    onError: (e) => toast({ title: "Couldn't send a test", description: errText(e), variant: "destructive" }),
  });
  if (!me || cfg.isLoading) return null;
  if (!cfg.data?.available) return <InstallGuide />;
  const adminOnly = !!me.isAdmin;
  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush(cfg.data!.publicKey);
      await recheck();
      queryClient.invalidateQueries({ queryKey: ["/api/push/config"] });
      toast({ title: "Notifications on", description: "This device will get crew requests and Crew Up plans. Send a test to check." });
    } catch (e) { toast({ title: "Couldn't turn on notifications", description: errText(e), variant: "destructive" }); await recheck(); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try { await disablePush(); await recheck(); queryClient.invalidateQueries({ queryKey: ["/api/push/config"] }); toast({ title: "Notifications off on this device" }); }
    finally { setBusy(false); }
  };
  return (
    <section id="notifications" className={cn("rounded-2xl bg-card p-4 space-y-3 scroll-mt-24", adminOnly ? "border border-dashed border-primary/60" : "border border-card-border")} data-testid="section-push">
      {adminOnly && <AudienceNote />}
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">{state === "on" ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <p className="text-xs text-muted-foreground" data-testid="text-push-state">
            {state === "on" ? "On for this device." : state === "denied" ? "Blocked for Wheelsdown on this device." : state === "install" ? "On iPhone, notifications work in the home-screen app." : state === "unsupported" ? "This browser can't get notifications." : "Get crew requests and Crew Up plans on your lock screen."}
            {cfg.data.devices > 0 && state !== "on" ? ` On for ${cfg.data.devices} other device${cfg.data.devices === 1 ? "" : "s"}.` : ""}
          </p>
        </div>
      </div>

      {state === "install" && (
        <ol className="space-y-2 rounded-xl bg-muted/60 p-3 text-xs" data-testid="list-push-install">
          <li className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-background font-bold">1</span>In Safari, tap <Share className="inline h-3.5 w-3.5" /> Share.</li>
          <li className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-background font-bold">2</span>Tap <SquarePlus className="inline h-3.5 w-3.5" /> Add to Home Screen, then Add.</li>
          <li className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-background font-bold">3</span>Open Wheelsdown from its icon and come back here.</li>
        </ol>
      )}
      {state === "denied" && <p className="rounded-xl bg-muted/60 p-3 text-xs">To allow them, open your phone's Settings, then Notifications, then Wheelsdown, and turn on Allow Notifications. Then come back here.</p>}

      <div className="flex flex-wrap gap-2">
        {state === "off" && <button type="button" onClick={turnOn} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-full taxi-sign px-4 text-sm font-semibold hover-elevate disabled:opacity-50" data-testid="button-push-on">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}Turn on notifications</button>}
        {state === "on" && <>
          <button type="button" onClick={() => test.mutate()} disabled={test.isPending} className="inline-flex h-10 items-center gap-1.5 rounded-full taxi-sign px-4 text-sm font-semibold hover-elevate disabled:opacity-50" data-testid="button-push-test">{test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}Send a test</button>
          <button type="button" onClick={turnOff} disabled={busy} className="inline-flex h-10 items-center rounded-full border border-border px-4 text-sm font-medium hover-elevate disabled:opacity-50" data-testid="button-push-off">Turn off on this device</button>
        </>}
      </div>

      <ul className="divide-y divide-border border-t border-border">
        {ROWS.filter((r) => (r.key !== "messages" || dmOn) && (r.key !== "delays" || delaysOn)).map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0"><span className="block text-sm font-medium">{r.title}</span><span className="block text-[11px] text-muted-foreground">{r.body}</span></span>
            <Switch checked={!!prefs[r.key]} onCheckedChange={(v) => save.mutate({ [r.key]: v })} aria-label={r.title} data-testid={`switch-push-${r.key}`} />
          </li>
        ))}
        <li className="py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-medium"><Moon className="h-3.5 w-3.5" />Rest hours</span><span className="block text-[11px] text-muted-foreground">Notifications still arrive, but without sound, between these times where you are.</span></span>
            <Switch checked={prefs.quiet} onCheckedChange={(v) => save.mutate({ quiet: v, tz: zone() || prefs.tz })} aria-label="Rest hours" data-testid="switch-push-quiet" />
          </div>
          {prefs.quiet && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <select value={prefs.quietStart} onChange={(e) => save.mutate({ quietStart: Number(e.target.value), tz: zone() || prefs.tz })} className="h-9 rounded-lg border border-input bg-background px-2 text-base sm:text-xs" aria-label="Rest hours start" data-testid="select-quiet-start">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              <span className="text-muted-foreground">to</span>
              <select value={prefs.quietEnd} onChange={(e) => save.mutate({ quietEnd: Number(e.target.value), tz: zone() || prefs.tz })} className="h-9 rounded-lg border border-input bg-background px-2 text-base sm:text-xs" aria-label="Rest hours end" data-testid="select-quiet-end">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
          )}
        </li>
      </ul>
    </section>
  );
}

/** Admins: who push is open to. Instant, no deploy. */
function AudienceNote() {
  const { toast } = useToast();
  const q = useQuery<{ audience: "admins" | "members"; devices: number; members: number; last24h: { kind: string; sent: number; failed: number }[] }>({ queryKey: ["/api/admin/push"], queryFn: async () => (await apiRequest("GET", "/api/admin/push")).json(), retry: false });
  const m = useMutation({
    mutationFn: async (audience: "admins" | "members") => (await apiRequest("PUT", "/api/admin/push", { audience })).json(),
    onSuccess: (r: { audience: string }) => {
      for (const k of ["/api/admin/push", "/api/push/config"]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: r.audience === "members" ? "Notifications open to members" : "Notifications back to admins only" });
    },
    onError: (e) => toast({ title: "Couldn't change it", description: errText(e), variant: "destructive" }),
  });
  if (!q.data) return <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Admin preview</p>;
  const live = q.data.audience === "members";
  const sent = q.data.last24h.reduce((a, r) => a + r.sent, 0), failed = q.data.last24h.reduce((a, r) => a + r.failed, 0);
  return (
    <div className="space-y-2 border-b border-dashed border-border pb-3" data-testid="row-push-audience">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{live ? "Open to members" : "Admin preview"}</p>
      <div className="flex items-start justify-between gap-3">
        <span><span className="block text-xs font-semibold">Open notifications to members</span><span className="block text-[11px] text-muted-foreground">{live ? "On: members are asked once, the next time they open the app." : "Off: only admins see this and get notifications."} {q.data.members} member{q.data.members === 1 ? "" : "s"} on {q.data.devices} device{q.data.devices === 1 ? "" : "s"}. Last 24 h: {sent} sent{failed ? `, ${failed} failed` : ""}.</span></span>
        <Switch checked={live} disabled={m.isPending} onCheckedChange={(v) => { if (window.confirm(v ? "Let every member turn on notifications? The next time they open the app, they'll be asked once." : "Turn notifications back to admins only? Members stop getting them; their settings are kept.")) m.mutate(v ? "members" : "admins"); }} aria-label="Open notifications to members" data-testid="switch-push-audience" />
      </div>
    </div>
  );
}

const ASK_KEY = "wd-push-ask";

/**
 * Once notifications are open to members, ask once on the next app open if this device doesn't already have them on.
 * Skipped the same visit as the signup tour (that tour already asks) and while another dialog is up.
 */
export function PushPrompt() {
  const { me } = useAuth();
  const { toast } = useToast();
  const cfg = usePushConfig();
  const [state, recheck, ready] = useDeviceState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ready || !me || !cfg.data?.opened || state === "on" || state === "unsupported") return;
    try {
      if (localStorage.getItem(ASK_KEY) || sessionStorage.getItem("wd-tour-this-visit")) return;
    } catch { return; }
    let tries = 0;
    let timer = 0;
    const tick = () => {
      if (document.querySelector("[role=dialog]")) {
        if (tries++ < 8) timer = window.setTimeout(tick, 1500);
        return;
      }
      try { localStorage.setItem(ASK_KEY, "1"); } catch { /* private mode: still show this once */ }
      setOpen(true);
    };
    timer = window.setTimeout(tick, 1600);
    return () => clearTimeout(timer);
  }, [ready, me?.id, cfg.data?.opened, state]);
  if (!me || !cfg.data?.opened) return null;
  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush(cfg.data!.publicKey);
      await recheck();
      queryClient.invalidateQueries({ queryKey: ["/api/push/config"] });
      setOpen(false);
      toast({ title: "Notifications on", description: "Crew requests and Crew Up plans will show up even when the app is closed." });
    } catch (e) { toast({ title: "Couldn't turn on notifications", description: errText(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const showHow = () => { setOpen(false); window.location.hash = "#/settings?s=push"; };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm" data-testid="dialog-push-ask">
        <DialogTitle className="flex items-center gap-2 text-lg"><BellRing className="h-5 w-5 text-primary" />Turn on notifications</DialogTitle>
        <DialogDescription>Crew requests and Crew Up plans can reach you even when the app is closed. You can turn each kind off in Settings.</DialogDescription>
        {state === "install" && (
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground" data-testid="list-push-ask-ios">
            <li>In Safari, tap Share, then Add to Home Screen.</li>
            <li>Open Wheelsdown from the new icon. On iPhone they only work from that icon, not a Safari tab.</li>
            <li>Tap the gear on Logbook, then Turn on notifications, then Allow.</li>
          </ol>
        )}
        {state === "denied" && <p className="text-xs text-muted-foreground">Notifications are blocked for Wheelsdown. Open your phone's Settings, then Notifications, then Wheelsdown, and turn on Allow Notifications.</p>}
        {state === "off" && <p className="text-xs text-muted-foreground">Your phone will ask you to allow them. On Android you can also add Wheelsdown to your home screen from the Chrome menu.</p>}
        <div className="mt-1 grid gap-2">
          {state === "off" && <button type="button" onClick={turnOn} disabled={busy} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold hover-elevate disabled:opacity-50" data-testid="button-push-ask-on">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}Turn on notifications</button>}
          {state === "install" && <button type="button" onClick={showHow} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-push-ask-how">Show me how</button>}
          <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-full border border-border text-sm font-medium hover-elevate" data-testid="button-push-ask-later">{state === "denied" ? "Got it" : "Not now"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
