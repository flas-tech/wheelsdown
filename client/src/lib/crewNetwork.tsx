// Crew network (admins first, crew_network_audience): overlaps with My Crew, family link, trip crew chat.
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarHeart, Check, Copy, Home as HomeIcon, MessageCircle, RefreshCw, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCrewNetwork } from "@/lib/experience";
import { useDmOn } from "@/lib/dm";
import { useMyCrew } from "@/lib/mycrew";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CrewNetworkMe, Overlap } from "@shared/crewNetwork";

const AdminsOnly = () => <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Admins only</span>;
export const fmtDay = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const msg = (e: any) => String(e?.message || e).replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");

function useNetMe() {
  const g = useCrewNetwork();
  return useQuery<CrewNetworkMe>({ queryKey: ["/api/crew-network/me"], enabled: g.on, staleTime: 30_000, retry: false });
}
function useSave() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (b: any) => (await apiRequest("PUT", "/api/crew-network/me", b)).json(),
    onSuccess: (d) => { queryClient.setQueryData(["/api/crew-network/me"], d); queryClient.invalidateQueries({ queryKey: ["/api/crew-network/overlaps"] }); },
    onError: (e) => toast({ title: msg(e), variant: "destructive" }),
  });
}

/** My Crew: "You'll overlap with" list, with the opt-in switch. */
export function OverlapsCard() {
  const g = useCrewNetwork();
  const me = useNetMe();
  const save = useSave();
  const q = useQuery<{ overlaps: Overlap[] }>({ queryKey: ["/api/crew-network/overlaps"], enabled: g.on && !!me.data?.overlaps, staleTime: 60_000, retry: false });
  if (!g.on || !me.data) return null;
  const list = q.data?.overlaps || [];
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-overlaps">
      <div className="flex items-center gap-2"><CalendarHeart className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Overlaps with your crew</h2>{g.adminOnly && <AdminsOnly />}
        <Switch className="ml-auto" checked={me.data.overlaps} onCheckedChange={(v) => save.mutate({ overlaps: v })} aria-label="Show overlaps with my crew" data-testid="switch-overlaps" /></div>
      {!me.data.overlaps ? <p className="mt-1.5 text-xs text-muted-foreground">Turn on to see when you and someone in My Crew will be at the same airport, from your trip sheets. They only see it if they turn it on too, and only the airport and dates are shared, never your trip sheet.</p>
        : list.length ? <ul className="mt-2 divide-y divide-border">{list.map((o, i) => (
          <li key={i} className="flex items-center gap-2 py-2 text-sm" data-testid={`row-overlap-${i}`}>
            <span className="font-code text-xs font-semibold">{o.icao}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{o.name}</span><span className="block text-xs text-muted-foreground">{o.city ? `${o.city} · ` : ""}{fmtDay(o.from)}{o.to !== o.from ? ` to ${fmtDay(o.to)}` : ""}</span></span>
            <Link href={`/meetup?icao=${o.icao}`} className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover-elevate">Crew Up</Link>
          </li>))}</ul>
        : <p className="mt-1.5 text-xs text-muted-foreground">No overlaps on your upcoming trip sheets yet. Add arrival dates to your stops so we can match them.</p>}
    </section>
  );
}

/** Settings / My Crew: a read-only link for family. */
export function FamilyLinkCard() {
  const g = useCrewNetwork();
  const me = useNetMe();
  const save = useSave();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  if (!g.on || !me.data) return null;
  const f = me.data.family;
  const copy = async () => {
    if (!f.url) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) { try { await nav.share({ url: f.url, title: "Where I am tonight" }); return; } catch (e) { if ((e as Error).name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(f.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { toast({ title: "Family link", description: f.url }); }
  };
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-family-link">
      <div className="flex items-center gap-2"><HomeIcon className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Family link</h2>{g.adminOnly && <AdminsOnly />}
        <Switch className="ml-auto" checked={f.on} onCheckedChange={(v) => save.mutate({ family: v })} aria-label="Family link" data-testid="switch-family" /></div>
      <p className="mt-1.5 text-xs text-muted-foreground">A read-only page for family: the city you're in tonight, local time there, and your next stops from your trip sheets. No account or password needed to view it. Turning it off kills the link.</p>
      {f.on && <>
        <div className="mt-3 flex items-center justify-between gap-2"><span className="text-sm">Show my hotel</span><Switch checked={f.showHotel} onCheckedChange={(v) => save.mutate({ showHotel: v })} aria-label="Show my hotel on the family link" data-testid="switch-family-hotel" /></div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={copy} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold" data-testid="button-family-copy">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Share link"}</button>
          <button type="button" onClick={() => { if (confirm("Make a new link? The old one stops working.")) save.mutate({ resetFamily: true }); }} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold" data-testid="button-family-reset"><RefreshCw className="h-4 w-4" />New link</button>
        </div>
        {f.url && <p className="mt-2 break-all text-[11px] text-muted-foreground" data-testid="text-family-url">{f.url}</p>}
      </>}
    </section>
  );
}

/** Trip sheet: start or open the crew chat for this trip with people from My Crew. Encrypted like all messages. */
export function TripCrewChat({ briefingId }: { briefingId: number }) {
  const g = useCrewNetwork();
  const dm = useDmOn();
  const crew = useMyCrew();
  const [, go] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<number[]>([]);
  const start = useMutation({
    mutationFn: async (userIds: number[]) => (await apiRequest("POST", `/api/dm/trip/${briefingId}`, { userIds })).json(),
    onSuccess: (r: { id: number }) => { queryClient.invalidateQueries({ queryKey: ["/api/dm/conversations"] }); go(`/messages/${r.id}`); },
    onError: (e) => toast({ title: msg(e), variant: "destructive" }),
  });
  if (!g.on || !dm) return null;
  const list = crew.data?.crew || [];
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-trip-chat">
      <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Trip crew chat</h2>{g.adminOnly && <AdminsOnly />}</div>
      <p className="mt-1 text-xs text-muted-foreground">One encrypted group for the people flying this trip. It closes a day after the last stop and is deleted 3 days after.</p>
      {!open ? <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full taxi-sign text-sm font-semibold" data-testid="button-trip-chat-pick"><Users className="h-4 w-4" />Pick crew</button>
        <button type="button" onClick={() => start.mutate([])} disabled={start.isPending} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold" data-testid="button-trip-chat-open"><MessageCircle className="h-4 w-4" />Open chat</button>
      </div> : <div className="mt-3">
        {list.length ? <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border">{list.map((c) => { const on = pick.includes(c.id); return (
          <li key={c.id}><button type="button" onClick={() => setPick(on ? pick.filter((x) => x !== c.id) : [...pick, c.id])} aria-pressed={on} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", on && "bg-primary/10")} data-testid={`button-trip-chat-person-${c.id}`}>
            <span className={cn("grid h-5 w-5 place-items-center rounded border", on ? "border-primary bg-primary text-[#0B1222]" : "border-border")}>{on && <Check className="h-3.5 w-3.5" />}</span>
            <span className="flex-1 truncate">{c.displayName}</span><span className="text-xs text-muted-foreground">{c.crewRole || ""}</span></button></li>); })}</ul>
          : <p className="text-sm text-muted-foreground">Add the people you fly with to <Link href="/mycrew" className="font-semibold underline">My Crew</Link> first.</p>}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setOpen(false); setPick([]); }} className="h-10 rounded-full border border-border text-sm font-semibold">Cancel</button>
          <button type="button" disabled={!pick.length || start.isPending} onClick={() => start.mutate(pick)} className="h-10 rounded-full taxi-sign text-sm font-semibold disabled:opacity-50" data-testid="button-trip-chat-start">Start chat{pick.length ? ` (${pick.length})` : ""}</button>
        </div>
      </div>}
    </section>
  );
}
