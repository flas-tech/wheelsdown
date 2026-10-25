// Participating FBOs (FBOs with a live Wheelsdown account) on trip sheets and Crew Up plans.
// Everything on the card is what the FBO entered in its portal; the link opens its crew page.
import { useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink, Phone, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

export type FboCardData = {
  id: number; name: string; icao: string; phone: string; website: string; url: string;
  intel: { label: string; value: string }[]; offers: { title: string; code: string }[]; recommends: number;
};

/** Participating FBOs at these airports (empty until the switch is open for you). */
export function useFbosAt(icaos: (string | null | undefined)[], src: "brief" | "crewup" = "crewup") {
  const codes = Array.from(new Set(icaos.filter(Boolean).map((c) => String(c).toUpperCase()))).sort();
  const q = useQuery<{ fbos: Record<string, FboCardData[]> }>({
    queryKey: ["/api/fbos-at", codes.join(","), src],
    queryFn: async () => (await apiRequest("GET", `/api/fbos-at?icaos=${encodeURIComponent(codes.join(","))}&src=${src}`)).json(),
    enabled: codes.length > 0, staleTime: 5 * 60_000, retry: false,
  });
  return q.data?.fbos || {};
}

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

/** The full card: brief stops and the Crew Up airport you're planning at. */
export function FboCard({ f, className }: { f: FboCardData; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-primary/60 bg-primary/5 p-3", className)} data-testid={`fbo-card-${f.id}`}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/20"><Building2 className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">FBO on Wheelsdown · <span className="font-code">{f.icao}</span></p>
          <p className="text-sm font-semibold leading-tight" data-testid={`text-fbo-name-${f.id}`}>{f.name}</p>
        </div>
      </div>
      {f.intel.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          {f.intel.map((x) => <div key={x.label} className="contents"><dt className="font-semibold">{x.label}</dt><dd className="min-w-0 break-words text-muted-foreground">{x.value}</dd></div>)}
        </dl>
      )}
      {f.offers.length > 0 && (
        <ul className="mt-2 space-y-1">
          {f.offers.map((o, i) => (
            <li key={i} className="flex items-start gap-1.5 rounded-lg border border-dashed border-primary/70 px-2 py-1.5 text-xs">
              <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0"><span className="font-semibold">{o.title}</span>{o.code && <> · code <span className="font-code font-bold select-all">{o.code}</span></>}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {f.phone && <a href={tel(f.phone)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold hover-elevate" data-testid={`link-fbo-call-${f.id}`}><Phone className="h-3.5 w-3.5" />Call</a>}
        <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full taxi-sign px-3 text-xs font-semibold hover-elevate" data-testid={`link-fbo-page-${f.id}`}>
          <ExternalLink className="h-3.5 w-3.5" />{f.recommends > 0 ? `Their crew picks (${f.recommends})` : "FBO page"}
        </a>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">Info from the FBO. Confirm fees and hours with the desk.</p>
    </div>
  );
}

/** One line per FBO: a plan card in Crew Up's Your plans. */
export function FboLine({ f }: { f: FboCardData }) {
  return (
    <a href={f.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 text-xs hover-elevate" data-testid={`fbo-line-${f.id}`}>
      <Building2 className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 truncate"><span className="font-semibold">{f.name}</span> is on Wheelsdown{f.offers.length ? ` · ${f.offers.length} crew deal${f.offers.length === 1 ? "" : "s"}` : ""}</span>
      <ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-60" />
    </a>
  );
}
