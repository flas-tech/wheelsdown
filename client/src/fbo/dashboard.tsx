import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Copy, ExternalLink, QrCode, Upload, Check, Circle } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { get } from "./api";
import { useMe } from "./App";
import { Card, PageHeader, btn, btnPrimary } from "./ui";

type Stats = {
  d7: { views: number; devices: number; qr: number }; d30: { views: number; devices: number; qr: number }; all: { views: number; devices: number; qr: number };
  adImpressions: number; adClicks: number; referrals: number; added: number; places: number; favorites: number; offers: number; intel: number; prints: number; daily: { day: string; views: number; qr: number }[];
};

export function DashboardPage() {
  const { me, openWelcome } = useMe();
  const { toast } = useToast();
  const { data: s } = useQuery<Stats>({ queryKey: ["/api/fbo/stats"], queryFn: get("/api/fbo/stats") });
  const copy = async () => { try { await navigator.clipboard.writeText(me.account.publicUrl); toast({ title: "Link copied" }); } catch { /* */ } };
  const steps = [
    { done: (s?.places || 0) >= 5, label: "Check at least five places you recommend", to: "/places" },
    { done: (s?.favorites || 0) > 0, label: "Star your favorites so they show first", to: "/places" },
    { done: (s?.offers || 0) > 0, label: "Add a crew discount or coupon code", to: "/offers" },
    { done: (s?.intel || 0) > 0, label: "Fill in your FBO intel", to: "/intel" },
    { done: (s?.prints || 0) > 0, label: "Print your QR code for the front desk", to: "/qr" },
    { done: false, label: "Put the self-serve sign in the pilot lounge", to: "/qr" },
  ];
  // fill missing days so the chart shows the whole month
  const days: { day: string; views: number; qr: number }[] = [];
  const by = new Map((s?.daily || []).map((d) => [d.day, d]));
  for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); days.push(by.get(d) || { day: d, views: 0, qr: 0 }); }
  const firstName = (me.user.name || "").split(" ")[0];
  return (
    <>
      <PageHeader title={firstName ? `Welcome, ${firstName}` : "Dashboard"} sub={<>Your crew page for {me.account.icao} shows everything you post here, labeled as provided by {me.account.name}. Changes go live as soon as you save.</>}
        actions={<><button className={btn} onClick={copy} data-testid="button-copy-link"><Copy className="h-4 w-4" />Copy link</button><a className={btn} href={me.account.publicUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />View crew page</a><Link href="/qr" className={btnPrimary}><QrCode className="h-4 w-4" />Print QR</Link></>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Page views · 7 days" value={s?.d7.views} sub={`${s?.d7.qr ?? 0} from QR scans`} />
        <Stat label="Page views · 30 days" value={s?.d30.views} sub={`${s?.d30.devices ?? 0} device-days`} />
        <Stat label="Recommendations" value={s?.places} sub={`${s?.favorites ?? 0} favorites · ${s?.offers ?? 0} live discounts`} />
        <Stat label="Crews who joined from your page" value={s?.referrals} sub={`${s?.adImpressions ?? 0} ad impressions · ${s?.adClicks ?? 0} clicks`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <p className="text-sm font-semibold">Crew page views, last 30 days</p>
          <p className="text-xs text-muted-foreground">Counts each device once per day per source. Link previews and bots aren't counted.</p>
          <div className="mt-3 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={days} margin={{ left: -20, right: 8, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d) => d.slice(5).replace("-", "/")} tick={{ fontSize: 11 }} interval={6} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="views" name="All views" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.25)" strokeWidth={2} />
                <Area type="monotone" dataKey="qr" name="QR scans" stroke="hsl(var(--foreground))" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <p className="text-sm font-semibold">Getting set up</p>
          <ul className="mt-3 space-y-1">
            {steps.map((st) => (
              <li key={st.label}>
                <Link href={st.to} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover-elevate">
                  {st.done ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className={cn(st.done && "text-muted-foreground line-through")}>{st.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/places" className={cn(btn, "mt-3 w-full")}><Upload className="h-4 w-4" />Upload an existing list</Link>
          <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><b className="text-foreground">Tip:</b> put the pilot lounge sign or a spare tablet running your kiosk page in the lounge, so crews can help themselves when the desk is busy.</div>
          <button className="mt-2 text-xs text-muted-foreground underline" onClick={openWelcome} data-testid="button-replay-welcome">Replay the welcome tour</button>
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">FBO accounts are a separate source of information from crews. Nothing you post earns points or appears on the crew leaderboard.</p>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value ?? "–"}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}
