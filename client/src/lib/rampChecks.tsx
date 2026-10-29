/**
 * Ramp check reports on FBO intel: crews flag fields where FAA or other federal inspectors are doing ramp checks so
 * the next crew in has their paperwork ready. Admins first (useRampChecks / ramp_checks_audience, enforced server-side).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldAlert, ClipboardCheck, Check, Trash2, ChevronDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useRampChecks } from "@/lib/experience";
import { Chip } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { RAMP_AGENCIES, RAMP_WHEN, RAMP_READY, RAMP_HOT_DAYS, type RampAirport, type RampReport } from "@shared/rampChecks";

const agencyLabel = (id: string) => RAMP_AGENCIES.find((a) => a.id === id)?.label || "Federal";
export function ago(t: number) {
  const h = (Date.now() - t) / 3600_000;
  if (h < 1) return "within the hour";
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
function AdminsOnly() { return <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Admins only</span>; }
const refresh = () => { queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/ramp-checks") }); };

function Ready() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary" data-testid="button-ramp-ready">
        <ClipboardCheck className="h-3.5 w-3.5" />Be ramp-check ready<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" data-testid="list-ramp-ready">{RAMP_READY.map((x) => <li key={x}>{x}</li>)}</ul>}
    </div>
  );
}

function ReportForm({ icao, onDone }: { icao: string; onDone: () => void }) {
  const { toast } = useToast();
  const [agency, setAgency] = useState<string>("faa");
  const [when, setWhen] = useState<string>("now");
  const [where, setWhere] = useState("");
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/ramp-checks", { icao, agency, when, where, note })).json(),
    onSuccess: () => { refresh(); toast({ title: "Thanks, crews will see it", description: `Ramp check reported at ${icao}.` }); onDone(); },
    onError: (e: Error) => toast({ title: "Couldn't post it", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-background p-3" data-testid={`form-ramp-${icao}`}>
      <div><p className="mb-1.5 text-xs font-semibold">Who was checking?</p>
        <div className="flex flex-wrap gap-2">{RAMP_AGENCIES.map((a) => <Chip key={a.id} active={agency === a.id} onClick={() => setAgency(a.id)} testId={`chip-ramp-agency-${a.id}`}>{a.label}</Chip>)}</div></div>
      <div><p className="mb-1.5 text-xs font-semibold">When?</p>
        <div className="flex flex-wrap gap-2">{RAMP_WHEN.map((w) => <Chip key={w.id} active={when === w.id} onClick={() => setWhen(w.id)} testId={`chip-ramp-when-${w.id}`}>{w.label}</Chip>)}</div></div>
      <input value={where} onChange={(e) => setWhere(e.target.value.slice(0, 80))} placeholder="Where on the field (optional), e.g. Signature ramp" className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" data-testid="input-ramp-where" />
      <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 240))} rows={2} placeholder="What they asked for (optional), e.g. checked medicals and W&B" className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm" data-testid="input-ramp-note" />
      <p className="text-[11px] text-muted-foreground">Your name isn't shown to other crews. Don't name or describe inspectors.</p>
      <div className="flex gap-2">
        <button type="button" disabled={m.isPending} onClick={() => m.mutate()} className="inline-flex h-9 items-center rounded-full taxi-sign px-4 text-xs font-semibold hover-elevate disabled:opacity-60" data-testid="button-ramp-submit">Post report</button>
        <button type="button" onClick={onDone} className="inline-flex h-9 items-center rounded-full border border-border px-4 text-xs font-semibold hover-elevate" data-testid="button-ramp-cancel">Cancel</button>
      </div>
    </div>
  );
}

function Report({ r }: { r: RampReport }) {
  const { me, requireAuth } = useAuth();
  const { toast } = useToast();
  const confirm = useMutation({ mutationFn: async () => (await apiRequest("POST", `/api/ramp-checks/${r.id}/confirm`)).json(), onSuccess: refresh,
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }) });
  const del = useMutation({ mutationFn: async () => (await apiRequest("DELETE", `/api/ramp-checks/${r.id}`)).json(), onSuccess: () => { refresh(); toast({ title: "Report removed" }); } });
  return (
    <li className="border-t border-border py-2 first:border-t-0" data-testid={`row-ramp-${r.id}`}>
      <p className="text-sm"><span className="font-semibold">{agencyLabel(r.agency)}</span> · {ago(r.seenAt)}{r.where && <> · {r.where}</>}</p>
      {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {!r.mine && <button type="button" onClick={() => requireAuth(() => confirm.mutate(), "Sign in to confirm ramp check reports.")} className={cn("inline-flex items-center gap-1 font-semibold", r.confirmed ? "text-primary" : "hover:text-foreground")} data-testid={`button-ramp-confirm-${r.id}`}>
          {r.confirmed && <Check className="h-3 w-3" />}Seen it too{r.confirms > 0 && ` · ${r.confirms}`}</button>}
        {r.mine && r.confirms > 0 && <span>{r.confirms} crew saw it too</span>}
        {r.by && <span>by {r.by} (admins see this)</span>}
        {(r.mine || me?.isAdmin) && <button type="button" onClick={() => del.mutate()} className="inline-flex items-center gap-1 hover:text-destructive" data-testid={`button-ramp-remove-${r.id}`}><Trash2 className="h-3 w-3" />Remove</button>}
      </div>
    </li>
  );
}

/** On FBO intel results: one card per airport on the route. */
export function RampChecks({ icaos }: { icaos: string[] }) {
  const gate = useRampChecks();
  const { requireAuth } = useAuth();
  const [form, setForm] = useState<string | null>(null);
  const key = `/api/ramp-checks?icaos=${icaos.join(",")}`;
  const q = useQuery<{ on: boolean; airports: RampAirport[] }>({ queryKey: [key], enabled: gate.on && icaos.length > 0, staleTime: 30_000, retry: false,
    queryFn: async () => (await apiRequest("GET", key)).json() });
  if (!gate.on || !q.data?.on) return null;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-ramp-checks">
      <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Ramp checks</h3>{gate.adminOnly && <AdminsOnly />}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">Crew reports of FAA and federal ramp checks, last 30 days.</p>
      {q.data.airports.map((a) => (
        <div key={a.icao} className="mt-3" data-testid={`ramp-airport-${a.icao}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-code text-xs font-semibold">{a.icao}</span>
            {a.active && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300" data-testid={`badge-ramp-active-${a.icao}`}>Active · {ago(a.last!)}</span>}
            {a.hot && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200" data-testid={`badge-ramp-hot-${a.icao}`}>Hot spot · {a.recent} in {RAMP_HOT_DAYS} days</span>}
            {!a.reports.length && <span className="text-xs text-muted-foreground">No reports</span>}
            <button type="button" onClick={() => requireAuth(() => setForm(form === a.icao ? null : a.icao), "Sign in to report a ramp check.")} className="ml-auto text-xs font-semibold text-primary" data-testid={`button-ramp-report-${a.icao}`}>Report one</button>
          </div>
          {a.reports.length > 0 && <ul className="mt-1">{a.reports.map((r) => <Report key={r.id} r={r} />)}</ul>}
          {form === a.icao && <ReportForm icao={a.icao} onDone={() => setForm(null)} />}
        </div>
      ))}
      <Ready />
    </section>
  );
}

/** FBO intel start screen: fields with recent reports. */
export function RampHotList() {
  const gate = useRampChecks();
  const q = useQuery<{ on: boolean; fields: { icao: string; name: string; city: string; reports: number; last: number; active: boolean }[] }>({ queryKey: ["/api/ramp-checks/hot"], enabled: gate.on, staleTime: 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/ramp-checks/hot")).json() });
  if (!gate.on || !q.data?.on) return null;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-ramp-hot">
      <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Recent ramp checks</h3>{gate.adminOnly && <AdminsOnly />}</div>
      {q.data.fields.length ? (
        <ul className="mt-2">{q.data.fields.map((f) => (
          <li key={f.icao} className="flex items-center gap-2 border-t border-border py-1.5 text-sm first:border-t-0" data-testid={`row-ramp-hot-${f.icao}`}>
            <span className="font-code text-xs font-semibold">{f.icao}</span><span className="min-w-0 flex-1 truncate text-muted-foreground">{f.city || f.name}</span>
            <span className={cn("text-xs", f.active ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>{f.reports} report{f.reports === 1 ? "" : "s"} · {ago(f.last)}</span>
          </li>))}</ul>
      ) : <p className="mt-1 text-xs text-muted-foreground">No reports in the last 30 days. Enter your route to see your fields or report one.</p>}
      <Ready />
    </section>
  );
}
