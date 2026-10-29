// Schedule tools (admins first, schedule_tools_audience): import a trip, add it to your calendar with alarms,
// keep trip sheets on this device for no-signal layovers, and a link to the duty/rest calculator.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { CalendarPlus, ClipboardPaste, CloudOff, FileUp, Loader2, Timer, Trash2, Upload, WifiOff } from "lucide-react";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { useScheduleTools, useFeatures } from "@/lib/experience";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { LAYOVERS } from "@shared/schema";
import { parsePaste, parseIcs, linesToStops, addDaysIso, type ProposedStop, type TripLine } from "@shared/schedule";
import { stopNights } from "@shared/crewNetwork";

const AdminsOnly = () => <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Admins only</span>;
const msg = (e: any) => String(e?.message || e).replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const inputCls = "h-10 rounded-xl border border-border bg-background px-3 text-sm";

// ---------------- import a trip ----------------
type Row = ProposedStop & { name: string };
export function ImportTripCard() {
  const g = useScheduleTools();
  const [, go] = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState<"closed" | "paste" | "file">("closed");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!g.on) return null;

  const find = async (lines: TripLine[]) => {
    const codes = Array.from(new Set(lines.flatMap((l) => l.codes)));
    if (!codes.length) { toast({ title: "No airport codes found", description: "Paste lines with airport codes like TEB-PBI or KLAS KSAN." }); return; }
    setBusy(true);
    try {
      const r = (await (await apiRequest("POST", "/api/schedule/resolve", { codes })).json()) as { airports: Record<string, { icao: string; name: string; city: string } | null> };
      const known = Object.fromEntries(Object.entries(r.airports).map(([k, v]) => [k, v?.icao || null]));
      const names = Object.fromEntries(Object.values(r.airports).filter(Boolean).map((v) => [v!.icao, v!.city || v!.name]));
      const st = linesToStops(lines, known);
      if (!st.length) { toast({ title: "No airports we know", description: "Check the codes, or build the trip sheet by hand." }); return; }
      setRows(st.map((s) => ({ ...s, name: names[s.icao] || "" })));
      setTitle(st.length > 1 ? `${st[0].icao} to ${st[st.length - 1].icao}` : st[0].icao);
    } catch (e) { toast({ title: msg(e), variant: "destructive" }); } finally { setBusy(false); }
  };
  const fromPaste = () => find(parsePaste(text, localToday()));
  const fromFile = async (f: File) => {
    if (f.size > 2_000_000) { toast({ title: "That file is too big" }); return; }
    const t = await f.text();
    find(/BEGIN:VCALENDAR/.test(t) ? parseIcs(t, localToday(), localDate) : parsePaste(t, localToday()));
  };
  const create = async () => {
    if (!rows?.length) return;
    setBusy(true);
    try {
      let stops = rows.map((r) => ({ icao: r.icao, layover: r.layover, ...(r.layover === "multi" ? { nights: r.nights || 2 } : {}), arriveDate: r.arriveDate, picks: [] as number[] }));
      try {
        const sug = (await (await apiRequest("POST", "/api/briefings/suggest", { title, stops })).json()) as { stops: { icao: string; picks: number[] }[] };
        stops = stops.map((s, i) => ({ ...s, icao: sug.stops[i]?.icao || s.icao, picks: sug.stops[i]?.picks || [] }));
      } catch { /* picks are optional; the sheet still saves */ }
      const b = (await (await apiRequest("POST", "/api/briefings", { title: title.trim().slice(0, 80), stops })).json()) as { id: number };
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"] });
      go(`/brief/${b.id}`);
    } catch (e) { toast({ title: msg(e), variant: "destructive" }); } finally { setBusy(false); }
  };
  const put = (i: number, p: Partial<Row>) => setRows((r) => r && r.map((x, k) => (k === i ? { ...x, ...p } : x)));

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-import-trip">
      <div className="flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Import a trip</h2>{g.adminOnly && <AdminsOnly />}</div>
      <p className="mt-1 text-xs text-muted-foreground">Paste your trip from the schedule, email or text, or open a calendar file (.ics). You check the stops before anything is saved.</p>
      {mode === "closed" && !rows && <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMode("paste")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold" data-testid="button-import-paste"><ClipboardPaste className="h-4 w-4" />Paste a trip</button>
        <button type="button" onClick={() => file.current?.click()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold" data-testid="button-import-file"><FileUp className="h-4 w-4" />Calendar file</button>
      </div>}
      <input ref={file} type="file" accept=".ics,text/calendar,.txt,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromFile(f); e.target.value = ""; }} data-testid="input-import-file" />
      {mode === "paste" && !rows && <div className="mt-3 space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 8000))} rows={6} placeholder={"29OCT TEB-PBI 0800\n30OCT PBI-TEB\n11/01 KTEB to KASE"} className="w-full rounded-xl border border-border bg-background p-3 font-code text-sm" aria-label="Trip text" data-testid="input-import-text" />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setMode("closed"); setText(""); }} className="h-10 rounded-full border border-border text-sm font-semibold">Cancel</button>
          <button type="button" onClick={fromPaste} disabled={!text.trim() || busy} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold disabled:opacity-50" data-testid="button-import-find">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Find stops</button>
        </div>
      </div>}
      {rows && <div className="mt-3 space-y-2" data-testid="panel-import-preview">
        <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} className={cn(inputCls, "w-full")} aria-label="Trip sheet name" data-testid="input-import-title" />
        <ul className="divide-y divide-border rounded-xl border border-border">{rows.map((r, i) => (
          <li key={i} className="space-y-1.5 p-2.5" data-testid={`row-import-${i}`}>
            <div className="flex items-center gap-2"><span className="font-code text-sm font-semibold">{r.icao}</span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.name}</span>
              <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={`Remove ${r.icao}`} className="grid h-8 w-8 place-items-center rounded-full hover-elevate" data-testid={`button-import-remove-${i}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></button></div>
            <div className="flex gap-2">
              <input type="date" value={r.arriveDate || ""} onChange={(e) => put(i, { arriveDate: e.target.value || null })} className={cn(inputCls, "min-w-0 flex-1")} aria-label={`${r.icao} arrival date`} />
              <select value={r.layover} onChange={(e) => put(i, { layover: e.target.value as Row["layover"], nights: e.target.value === "multi" ? r.nights || 2 : undefined })} className={cn(inputCls, "min-w-0 flex-1")} aria-label={`${r.icao} layover`}>
                {LAYOVERS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
              {r.layover === "multi" && <input type="number" min={2} max={14} value={r.nights || 2} onChange={(e) => put(i, { nights: Math.max(2, Math.min(14, Number(e.target.value) || 2)) })} className={cn(inputCls, "w-16")} aria-label={`${r.icao} nights`} />}
            </div>
          </li>))}</ul>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setRows(null); setMode("closed"); }} className="h-10 rounded-full border border-border text-sm font-semibold">Start over</button>
          <button type="button" onClick={create} disabled={busy || !rows.length} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold disabled:opacity-50" data-testid="button-import-create">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create trip sheet</button>
        </div>
      </div>}
    </section>
  );
}

// ---------------- offline copy ----------------
const OFFLINE = "wd-offline-v1";
const OFF_KEY = "wd-offline";
const offlineSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "caches" in window;
const isOfflineOn = () => { try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; } };
async function swPost(type: string) {
  try { const r = await navigator.serviceWorker.getRegistration("/"); (r?.active || navigator.serviceWorker.controller)?.postMessage({ type }); } catch {}
}
/** Save the app and your trip sheets on this device. Safe to call again to refresh. */
export async function saveOffline() {
  if (!offlineSupported() || !getAuthToken()) return 0;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const cache = await caches.open(OFFLINE);
  try { localStorage.setItem(OFF_KEY, "1"); } catch {}
  queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, networkMode: "offlineFirst" } });
  await swPost("wd-offline-on");
  const auth = { authorization: `Bearer ${getAuthToken()}` };
  const put = async (u: string, h?: Record<string, string>) => { try { const r = await fetch(u, { headers: h, cache: "no-store" }); if (r.ok) await cache.put(new URL(u, location.origin).href, r); } catch {} };
  await put("/");
  const assets = Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[rel=stylesheet], link[rel=modulepreload], link[rel=icon], link[rel=manifest]"))
    .map((e) => ("src" in e && e.src) || (e as HTMLLinkElement).href).filter((u) => u && new URL(u).origin === location.origin);
  await Promise.all(assets.map((u) => put(u)));
  await Promise.all(["/api/me", "/api/features"].map((u) => put(u, auth)));
  let list: { id: number }[] = [];
  try { const r = await fetch("/api/briefings", { headers: auth, cache: "no-store" }); if (r.ok) { list = await r.clone().json(); await cache.put(new URL("/api/briefings", location.origin).href, r); } } catch {}
  await Promise.all(list.slice(0, 30).map((b) => put(`/api/briefings/${b.id}`, auth)));
  try { localStorage.setItem("wd-offline-at", String(Date.now())); } catch {}
  return list.length;
}
export async function clearOffline() {
  try { localStorage.removeItem(OFF_KEY); localStorage.removeItem("wd-offline-at"); } catch {}
  queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, networkMode: "online" } });
  if (!offlineSupported()) return;
  await swPost("wd-offline-off");
  try { await caches.delete(OFFLINE); } catch {}
}
/** App-wide: keeps the saved copy fresh, drops it if schedule tools are closed to you, and shows an offline note. */
export function OfflineKeeper() {
  const g = useScheduleTools();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); addEventListener("online", a); addEventListener("offline", b); return () => { removeEventListener("online", a); removeEventListener("offline", b); }; }, []);
  useEffect(() => {
    if (!isOfflineOn() || !online || !g.ready) return;
    if (!g.on) { void clearOffline(); return; }
    const at = Number(localStorage.getItem("wd-offline-at") || 0);
    if (Date.now() - at > 30 * 60_000) void saveOffline();
  }, [g.on, g.ready, online]);
  if (online || !isOfflineOn()) return null;
  return <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-1.5 bg-[#0B1222] px-3 py-1.5 text-xs font-semibold text-white" role="status" data-testid="banner-offline"><WifiOff className="h-3.5 w-3.5 text-primary" />No signal. Showing trip sheets saved on this device.</div>;
}

// ---------------- trip sheet: calendar, offline, duty ----------------
type Time = { stop: number; kind: "lobby" | "report"; date: string; time: string };
export function TripScheduleCard({ brief }: { brief: { id: number; stops: { icao: string; layover: string; nights?: number; arriveDate?: string | null }[] } }) {
  const g = useScheduleTools();
  const { toast } = useToast();
  const key = `wd-times-${brief.id}`;
  const [times, setTimes] = useState<Time[]>(() => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } });
  const [alarm, setAlarm] = useState(60);
  const [off, setOff] = useState(isOfflineOn());
  const [saving, setSaving] = useState(false);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(times)); } catch {} }, [key, times]);
  const cal = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/schedule/ics/${brief.id}`, { times: times.filter((t) => t.date && t.time), alarm })).json(),
    onSuccess: (r: { url: string }) => { window.location.href = r.url; },
    onError: (e) => toast({ title: msg(e), variant: "destructive" }),
  });
  if (!g.on) return null;
  const leave = (s: (typeof brief.stops)[number]) => s.arriveDate ? addDaysIso(s.arriveDate, stopNights(s.layover, s.nights)) : "";
  const get = (i: number, kind: Time["kind"]) => times.find((t) => t.stop === i && t.kind === kind);
  const set = (i: number, kind: Time["kind"], p: Partial<Time>) => setTimes((ts) => {
    const cur = ts.find((t) => t.stop === i && t.kind === kind) || { stop: i, kind, date: leave(brief.stops[i]), time: "" };
    const nx = { ...cur, ...p };
    return [...ts.filter((t) => !(t.stop === i && t.kind === kind)), ...(nx.time ? [nx] : [])];
  });
  const toggleOff = async (v: boolean) => {
    setSaving(true);
    try { if (v) { const n = await saveOffline(); setOff(true); toast({ title: "Saved on this device", description: `${n} trip sheet${n === 1 ? "" : "s"} will open with no signal.` }); } else { await clearOffline(); setOff(false); } }
    catch (e) { toast({ title: msg(e), variant: "destructive" }); } finally { setSaving(false); }
  };
  const firstDate = brief.stops.find((s) => s.arriveDate)?.arriveDate || "";
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-trip-schedule">
      <div className="flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Calendar and alarms</h2>{g.adminOnly && <AdminsOnly />}</div>
      <p className="mt-1 text-xs text-muted-foreground">Adds each stop to your phone's calendar. Add lobby or report times (local at that airport) to get an alarm before each one.</p>
      <ul className="mt-2 divide-y divide-border rounded-xl border border-border">{brief.stops.map((s, i) => (
        <li key={i} className="p-2.5" data-testid={`row-cal-${i}`}>
          <p className="text-sm"><span className="font-code font-semibold">{s.icao}</span><span className="text-xs text-muted-foreground">{s.arriveDate ? ` · ${fmtDay(s.arriveDate)}` : " · no date"}</span></p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">{(["lobby", "report"] as const).map((k) => { const t = get(i, k); return (
            <label key={k} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k === "lobby" ? "Lobby" : "Report"}
              <input type="time" value={t?.time || ""} onChange={(e) => set(i, k, { time: e.target.value })} className={cn(inputCls, "mt-0.5 w-full font-normal normal-case tracking-normal text-foreground")} aria-label={`${k} time at ${s.icao}`} data-testid={`input-${k}-${i}`} />
              {t?.time && <input type="date" value={t.date} onChange={(e) => set(i, k, { date: e.target.value })} className={cn(inputCls, "mt-1 w-full font-normal normal-case tracking-normal text-foreground")} aria-label={`${k} date at ${s.icao}`} />}
            </label>); })}</div>
        </li>))}</ul>
      <div className="mt-2 flex items-center gap-2">
        <label className="flex-1 text-xs text-muted-foreground">Alarm
          <select value={alarm} onChange={(e) => setAlarm(Number(e.target.value))} className={cn(inputCls, "ml-2")} aria-label="Alarm before" data-testid="select-alarm">
            {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`} before</option>)}</select></label>
        <button type="button" onClick={() => cal.mutate()} disabled={cal.isPending} className="inline-flex h-10 items-center gap-1.5 rounded-full taxi-sign px-4 text-sm font-semibold disabled:opacity-50" data-testid="button-add-calendar">{cal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}Add to calendar</button>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-center gap-2"><CloudOff className="h-4 w-4 text-muted-foreground" /><span className="flex-1 text-sm font-semibold">Keep trip sheets on this device</span>
          <Switch checked={off} disabled={saving || !offlineSupported()} onCheckedChange={(v) => void toggleOff(v)} aria-label="Keep trip sheets on this device" data-testid="switch-offline" /></div>
        <p className="mt-1 text-xs text-muted-foreground">{offlineSupported() ? "Open your trip sheets with no signal, in the air or at a remote field. Refreshes when you're back online. Signing out removes the copy." : "This browser can't keep a copy. Use Safari or Chrome, or save the PDF."}</p>
      </div>
      <Link href={`/duty${firstDate ? `?date=${firstDate}` : ""}`} className="mt-3 flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-semibold hover-elevate" data-testid="link-duty"><Timer className="h-4 w-4 text-primary" />Duty and rest calculator<span className="ml-auto text-xs font-normal text-muted-foreground">Part 117, 135, 91</span></Link>
    </section>
  );
}
