// Family link (public, read-only): where a crew member is tonight and their next stops. No account needed.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Loader2, MapPin, PlaneLanding, BedDouble } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { fmtDay } from "@/lib/crewNetwork";
import type { FamilyStop, FamilyView } from "@shared/crewNetwork";

const timeIn = (tz: string | null) => { if (!tz) return null; try { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", weekday: "short", timeZone: tz }).format(new Date()); } catch { return null; } };
const place = (s: FamilyStop) => [s.city, s.country && s.country !== "US" ? s.country : ""].filter(Boolean).join(", ") || s.name || s.icao;

export default function FamilyPage() {
  const [, p] = useRoute("/f/:token");
  const tok = p?.token || "";
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(i); }, []);
  const q = useQuery<FamilyView>({ queryKey: ["/api/family", tok], enabled: !!tok, refetchInterval: 5 * 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/family/${tok}`)).json() });
  if (q.isLoading) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!q.data) return <div className="mx-auto max-w-md px-4 py-10 text-center"><p className="text-lg font-semibold">This link isn't active</p><p className="mt-1 text-sm text-muted-foreground">Ask for a new one.</p></div>;
  const d = q.data;
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6" data-testid="page-family">
      <h1 className="text-xl font-semibold">Where {d.name} is</h1>
      {d.now ? (
        <section className="overflow-hidden rounded-2xl bg-[#0B1222] p-5 text-white" data-testid="card-family-now">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{d.checkedInAt ? "Landed" : "Tonight"}</p>
          <p className="mt-1 text-2xl font-bold">{place(d.now)}</p>
          <p className="text-sm text-white/70"><span className="font-code text-primary">{d.now.icao}</span>{d.now.name ? ` · ${d.now.name}` : ""}</p>
          {timeIn(d.now.tz) && <p className="mt-3 font-code text-2xl font-bold tabular">{timeIn(d.now.tz)} <span className="text-xs font-normal text-white/60">local</span></p>}
          {d.now.to !== d.now.from && <p className="mt-1 text-xs text-white/70">There until {fmtDay(d.now.to)}</p>}
          {d.now.hotel && <p className="mt-3 flex items-center gap-1.5 text-sm"><BedDouble className="h-4 w-4 text-primary" />{d.now.hotel}</p>}
          {d.checkedInAt && <p className="mt-2 flex items-center gap-1.5 text-xs text-white/70"><PlaneLanding className="h-3.5 w-3.5" />Checked in {new Date(d.checkedInAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} your time</p>}
        </section>
      ) : <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No trip for tonight on file.</p>}
      {d.next.length > 0 && <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-family-next">
        <h2 className="text-sm font-semibold">Coming up</h2>
        <ul className="mt-1 divide-y divide-border">{d.next.map((s, i) => (
          <li key={i} className="flex items-center gap-2 py-2 text-sm"><MapPin className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="flex-1 truncate">{place(s)} <span className="font-code text-xs text-muted-foreground">{s.icao}</span></span><span className="text-xs text-muted-foreground">{fmtDay(s.from)}</span></li>))}</ul>
      </section>}
      <p className="text-center text-[11px] text-muted-foreground">Shared from Wheelsdown, the crew layover guide. Plans change; this shows the trip sheet as entered.</p>
    </div>
  );
}
