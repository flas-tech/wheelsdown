/**
 * Ramp check reports on FBO intel: crews flag fields where FAA, other federal or local (abroad) inspectors are doing ramp checks so
 * the next crew in has their paperwork ready. Admins first (useRampChecks / ramp_checks_audience, enforced server-side).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ShieldAlert, ClipboardCheck, Check, Trash2, ChevronDown, Map as MapIcon } from "lucide-react";
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

/**
 * Reporting in one tap: tap who's checking and it's posted as "right now". "It was earlier" switches the time first.
 * After posting, optional details (where on the field, what they asked for) can be added.
 */
export function QuickReport({ icao, onDone, dark }: { icao: string; onDone: () => void; dark?: boolean }) {
  const { toast } = useToast();
  const { requireAuth } = useAuth();
  const [when, setWhen] = useState<string>("now");
  const [earlier, setEarlier] = useState(false);
  const [posted, setPosted] = useState<number | null>(null);
  const [where, setWhere] = useState("");
  const [note, setNote] = useState("");
  const err = (e: Error) => toast({ title: "Couldn't post it", description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
  const post = useMutation({
    mutationFn: async (agency: string) => (await apiRequest("POST", "/api/ramp-checks", { icao, agency, when })).json(),
    onSuccess: (r: { id: number }) => { refresh(); setPosted(r.id); },
    onError: err,
  });
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/ramp-checks/${posted}`, { where, note })).json(),
    onSuccess: () => { refresh(); toast({ title: "Details added" }); onDone(); },
    onError: err,
  });
  const box = dark ? "border-white/15 bg-white/5 text-white" : "border-border bg-background";
  const sub = dark ? "text-white/60" : "text-muted-foreground";
  const field = dark ? "border-white/20 bg-white/10 text-white placeholder:text-white/50" : "border-input bg-card";
  if (posted) return (
    <div className={cn("mt-2 space-y-2 rounded-xl border p-3", box)} data-testid={`form-ramp-details-${icao}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Check className="h-4 w-4 text-primary" />Reported at {icao}. Thanks.</p>
      <p className={cn("text-xs", sub)}>Add details if you like. Don't name or describe inspectors.</p>
      <input value={where} onChange={(e) => setWhere(e.target.value.slice(0, 80))} placeholder="Where on the field, e.g. Signature ramp" className={cn("h-10 w-full rounded-lg border px-3 text-sm", field)} data-testid="input-ramp-where" />
      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 240))} placeholder="What they asked for, e.g. medicals and W&B" className={cn("h-10 w-full rounded-lg border px-3 text-sm", field)} data-testid="input-ramp-note" />
      <div className="flex gap-2">
        <button type="button" disabled={save.isPending || (!where.trim() && !note.trim())} onClick={() => save.mutate()} className="inline-flex h-9 items-center rounded-full taxi-sign px-4 text-xs font-semibold hover-elevate disabled:opacity-50" data-testid="button-ramp-save">Save details</button>
        <button type="button" onClick={onDone} className={cn("inline-flex h-9 items-center rounded-full border px-4 text-xs font-semibold hover-elevate", dark ? "border-white/20" : "border-border")} data-testid="button-ramp-done">Done</button>
      </div>
    </div>
  );
  return (
    <div className={cn("mt-2 rounded-xl border p-3", box)} data-testid={`form-ramp-${icao}`}>
      <p className="text-sm font-semibold">Who's doing ramp checks at {icao}?</p>
      <p className={cn("text-xs", sub)}>Tap one to post it{when === "now" ? " as happening now" : ""}. Your name isn't shown.</p>
      {earlier && <div className="mt-2 flex flex-wrap gap-2">{RAMP_WHEN.map((w) => <Chip key={w.id} active={when === w.id} onClick={() => setWhen(w.id)} testId={`chip-ramp-when-${w.id}`}>{w.label}</Chip>)}</div>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {RAMP_AGENCIES.map((a) => (
          <button key={a.id} type="button" disabled={post.isPending} onClick={() => requireAuth(() => post.mutate(a.id), "Sign in to report a ramp check.")}
            className="h-11 rounded-xl taxi-sign px-3 text-sm font-semibold hover-elevate disabled:opacity-60" data-testid={`button-ramp-post-${a.id}`}>{a.label}</button>
        ))}
      </div>
      <div className={cn("mt-2 flex items-center justify-between text-xs", sub)}>
        {!earlier ? <button type="button" onClick={() => setEarlier(true)} className="font-semibold underline-offset-2 hover:underline" data-testid="button-ramp-earlier">It was earlier</button> : <span />}
        <button type="button" onClick={onDone} className="font-semibold" data-testid="button-ramp-cancel">Cancel</button>
      </div>
    </div>
  );
}

/** Home "At the field now" card: ramp check status for the field you're at, with a one-tap report. */
export function RampHere({ icao }: { icao: string }) {
  const gate = useRampChecks();
  const [open, setOpen] = useState(false);
  const key = `/api/ramp-checks?icaos=${icao}`;
  const q = useQuery<{ on: boolean; airports: RampAirport[] }>({ queryKey: [key], enabled: gate.on && !!icao, staleTime: 30_000, retry: false,
    queryFn: async () => (await apiRequest("GET", key)).json() });
  if (!gate.on || !q.data?.on) return null;
  const a = q.data.airports[0];
  const latest = a?.reports[0];
  return (
    <div className="border-t border-white/10 px-4 py-2.5 text-white" data-testid="row-ramp-here">
      <div className="flex items-center gap-2">
        <ShieldAlert className={cn("h-4 w-4 shrink-0", a?.active ? "text-red-400" : "text-white/60")} />
        <span className="min-w-0 flex-1 text-xs leading-snug text-white/80" data-testid="text-ramp-here">
          {a?.active && latest ? <><span className="font-semibold text-red-300">{agencyLabel(latest.agency)} ramp checks</span> reported {ago(latest.seenAt)}</> : latest ? `Last ramp check report ${ago(latest.seenAt)}` : "No ramp checks reported here"}
        </span>
        {!open && <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-primary hover-elevate" data-testid="button-ramp-here">Report ramp check</button>}
      </div>
      {open && <QuickReport icao={icao} dark onDone={() => setOpen(false)} />}
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
      <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Ramp checks</h3>{gate.adminOnly && <AdminsOnly />}<Link href="/ramp-checks" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary" data-testid="link-ramp-map"><MapIcon className="h-3.5 w-3.5" />World map</Link></div>
      <p className="mt-0.5 text-xs text-muted-foreground">Crew reports of FAA and federal ramp checks, last 30 days.</p>
      {q.data.airports.map((a) => (
        <div key={a.icao} className="mt-3" data-testid={`ramp-airport-${a.icao}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-code text-xs font-semibold">{a.icao}</span>
            {a.active && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300" data-testid={`badge-ramp-active-${a.icao}`}>Active · {ago(a.last!)}</span>}
            {a.hot && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200" data-testid={`badge-ramp-hot-${a.icao}`}>Hot spot · {a.recent} in {RAMP_HOT_DAYS} days</span>}
            {!a.reports.length && <span className="text-xs text-muted-foreground">No reports</span>}
            <button type="button" onClick={() => setForm(form === a.icao ? null : a.icao)} className="ml-auto text-xs font-semibold text-primary" data-testid={`button-ramp-report-${a.icao}`}>Report ramp check</button>
          </div>
          {a.reports.length > 0 && <ul className="mt-1">{a.reports.map((r) => <Report key={r.id} r={r} />)}</ul>}
          {form === a.icao && <QuickReport icao={a.icao} onDone={() => setForm(null)} />}
        </div>
      ))}
      <Ready />
    </section>
  );
}

/** FBO intel start screen: fields with recent reports. */
export function RampHotList() {
  const gate = useRampChecks();
  const [code, setCode] = useState("");
  const [go, setGo] = useState("");
  const q = useQuery<{ on: boolean; fields: { icao: string; name: string; city: string; reports: number; last: number; active: boolean }[] }>({ queryKey: ["/api/ramp-checks/hot"], enabled: gate.on, staleTime: 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/ramp-checks/hot")).json() });
  if (!gate.on || !q.data?.on) return null;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-ramp-hot">
      <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Recent ramp checks</h3>{gate.adminOnly && <AdminsOnly />}<Link href="/ramp-checks" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary" data-testid="link-ramp-map"><MapIcon className="h-3.5 w-3.5" />World map</Link></div>
      {q.data.fields.length ? (
        <ul className="mt-2">{q.data.fields.map((f) => (
          <li key={f.icao} className="flex items-center gap-2 border-t border-border py-1.5 text-sm first:border-t-0" data-testid={`row-ramp-hot-${f.icao}`}>
            <span className="font-code text-xs font-semibold">{f.icao}</span><span className="min-w-0 flex-1 truncate text-muted-foreground">{f.city || f.name}</span>
            <span className={cn("text-xs", f.active ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>{f.reports} report{f.reports === 1 ? "" : "s"} · {ago(f.last)}</span>
          </li>))}</ul>
      ) : <p className="mt-1 text-xs text-muted-foreground">No reports in the last 30 days.</p>}
      {go ? <QuickReport icao={go} onDone={() => { setGo(""); setCode(""); }} /> : (
        <form onSubmit={(e) => { e.preventDefault(); if (/^[A-Z0-9]{3,4}$/.test(code)) setGo(code); }} className="mt-3 flex gap-2" data-testid="form-ramp-hot-report">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))} placeholder="Airport (TEB)" aria-label="Airport code"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-code text-sm" data-testid="input-ramp-hot-icao" />
          <button type="submit" disabled={code.length < 3} className="h-10 shrink-0 rounded-lg taxi-sign px-3 text-sm font-semibold disabled:opacity-50" data-testid="button-ramp-hot-report">Report ramp check</button>
        </form>
      )}
      <Ready />
    </section>
  );
}
