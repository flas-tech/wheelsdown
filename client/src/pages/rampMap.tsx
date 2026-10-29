// Ramp check map: every field worldwide with a recent ramp check report (FAA, CBP, TSA, local authorities abroad).
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useRampChecks } from "@/lib/experience";
import { BackButton } from "@/lib/tripNav";
import { Chip } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ago } from "@/lib/rampChecks";
import { rampColor } from "@/lib/rampMapColor";
import { RAMP_AGENCIES, RAMP_MAP_DAYS, type RampMapField } from "@shared/rampChecks";

const RampMap = lazy(() => import("@/lib/rampMap"));
const REGIONS = [
  { id: "all", label: "Everywhere" },
  { id: "us", label: "United States" },
  { id: "intl", label: "International" },
] as const;

export default function RampMapPage() {
  const gate = useRampChecks();
  const [days, setDays] = useState<number>(90);
  const [agency, setAgency] = useState("all");
  const [region, setRegion] = useState<string>("all");
  const [focus, setFocus] = useState<string | null>(null);
  const q = useQuery<{ on: boolean; fields: RampMapField[] }>({ queryKey: ["/api/ramp-checks/map", days], enabled: gate.on, staleTime: 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/ramp-checks/map?days=${days}`)).json() });
  const fields = useMemo(() => (q.data?.fields || []).filter((f) => {
    const us = f.country === "US" || /^K[A-Z0-9]{3}$/.test(f.icao) || /^P[AHF]/.test(f.icao);
    if (region === "us" && !us) return false;
    if (region === "intl" && us) return false;
    return agency === "all" || (f.agencies[agency] || 0) > 0;
  }), [q.data, agency, region]);
  const countries = new Set(fields.map((f) => f.country).filter(Boolean)).size;

  if (!gate.on) return (
    <div className="mx-auto max-w-3xl px-4 py-6"><BackButton fallback="/" /><p className="mt-4 text-sm text-muted-foreground">Ramp check reports aren't available on your account yet.</p></div>
  );
  return (
    <div className="mx-auto max-w-3xl px-4 py-4" data-testid="page-ramp-map">
      <BackButton fallback="/" className="mb-2" />
      <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /><h1 className="text-lg font-semibold">Ramp check map</h1>
        {gate.adminOnly && <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Admins only</span>}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">Where crews have reported FAA, federal or local-authority ramp checks, worldwide. Reports are from crews and unverified.</p>

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="filter-ramp-days">
        {RAMP_MAP_DAYS.map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)} testId={`chip-ramp-days-${d}`}>{d === 365 ? "1 year" : `${d} days`}</Chip>)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="filter-ramp-region">
        {REGIONS.map((r) => <Chip key={r.id} active={region === r.id} onClick={() => setRegion(r.id)} testId={`chip-ramp-region-${r.id}`}>{r.label}</Chip>)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="filter-ramp-agency">
        <Chip active={agency === "all"} onClick={() => setAgency("all")} testId="chip-ramp-agency-all">All agencies</Chip>
        {RAMP_AGENCIES.map((a) => <Chip key={a.id} active={agency === a.id} onClick={() => setAgency(a.id)} testId={`chip-ramp-agency-${a.id}`}>{a.label}</Chip>)}
      </div>

      <div className="relative mt-3 overflow-hidden rounded-2xl border border-card-border">
        <Suspense fallback={<div className="grid h-[360px] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
          <RampMap fields={fields} focus={focus} onPick={setFocus} className="h-[360px] w-full sm:h-[440px]" />
        </Suspense>
        {q.isLoading && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/40"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="legend-ramp-map">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-red-600" />Active (last 48h)</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-amber-500" />Hot spot (3+ in 90 days)</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-slate-500" />Earlier report</span>
        <span className="ml-auto">{fields.length} field{fields.length === 1 ? "" : "s"}{countries > 1 ? ` · ${countries} countries` : ""}</span>
      </div>

      <section className="mt-3 rounded-2xl border border-card-border bg-card p-4" data-testid="list-ramp-map">
        <h2 className="text-sm font-semibold">Most recent</h2>
        {fields.length ? (
          <ul className="mt-1">{fields.map((f) => (
            <li key={f.icao}>
              <button type="button" onClick={() => { setFocus(f.icao); document.querySelector("[data-testid=map-ramp]")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className={cn("flex w-full items-center gap-2 border-t border-border py-2 text-left text-sm", focus === f.icao && "bg-primary/5")} data-testid={`row-ramp-map-${f.icao}`}>
                <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: rampColor(f) }} />
                <span className="font-code text-xs font-semibold">{f.icao}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{[f.city || f.name, f.country].filter(Boolean).join(" · ")}</span>
                <span className={cn("shrink-0 text-xs", f.active ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>{f.reports} · {ago(f.last)}</span>
              </button>
            </li>))}</ul>
        ) : <p className="mt-1 text-xs text-muted-foreground">{q.isLoading ? "Loading…" : "No ramp checks reported for this filter."}</p>}
        <p className="mt-3 text-xs text-muted-foreground">Seeing one? Report it from <Link href="/" className="font-semibold text-primary">Home</Link> or FBO intel. Abroad, pick "Local aviation authority" or "Local customs / police".</p>
      </section>
    </div>
  );
}
