// Duty and rest calculator (advisory only), behind schedule_tools_audience. Math in shared/schedule.ts.
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, CircleHelp, Timer, XCircle } from "lucide-react";
import { useScheduleTools } from "@/lib/experience";
import { cn } from "@/lib/utils";
import { dutyCalc, type DutyIn, type DutyRules } from "@shared/schedule";

const KEY = "wd-duty";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const show = (dt: string) => { const d = new Date(dt + ":00Z"); return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} ${dt.slice(11, 16)}`; };
const inp = "h-11 w-full rounded-xl border border-border bg-background px-3 text-base";
const numOrU = (v: string) => (v === "" ? undefined : Math.max(0, Number(v) || 0));

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-semibold">{label}</span>{children}{hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}</label>;
}

export default function DutyPage() {
  const g = useScheduleTools();
  const q = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
  const [s, setS] = useState<DutyIn & { relDate?: string; relTime?: string }>(() => {
    let saved: any = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
    return { rules: "135", reportTime: "07:00", segments: 2, pilots: 2, companyDuty: 14, companyRest: 10, ...saved, reportDate: q.get("date") || saved.reportDate || today() };
  });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }, [s]);
  const set = (p: Partial<typeof s>) => setS((x) => ({ ...x, ...p }));
  const out = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.reportDate) || !/^\d{2}:\d{2}$/.test(s.reportTime)) return null;
    const releaseAt = s.relDate && s.relTime ? `${s.relDate}T${s.relTime}` : null;
    return dutyCalc({ ...s, releaseAt });
  }, [s]);
  if (!g.on) return <div className="py-10 text-center text-sm text-muted-foreground">Not available yet. <Link href="/home" className="font-semibold underline">Home</Link></div>;
  const bad = out?.checks.some((c) => c.ok === false);
  return (
    <div className="space-y-4" data-testid="page-duty">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Timer className="h-5 w-5 text-primary" />Duty and rest{g.adminOnly && <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Admins only</span>}</h1>
        <p className="mt-1 text-sm text-muted-foreground">When your duty has to end, when you can report next, and the limits that apply.</p>
      </header>
      <div className="flex gap-2 rounded-2xl border border-amber-500/50 bg-amber-500/10 p-3 text-xs" data-testid="note-advisory"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /><p><span className="font-semibold">Advisory only.</span> A planning aid, not an approved scheduling or tracking system. Your certificate holder's ops specs, manual and scheduling system, and the regulations themselves, decide what's legal. Extensions, augmented crews, split duty, reserve and deadhead rules aren't covered.</p></div>

      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1" role="tablist" aria-label="Rules">
        {(["117", "135", "91"] as DutyRules[]).map((r) => <button key={r} type="button" role="tab" aria-selected={s.rules === r} onClick={() => set({ rules: r })} className={cn("h-9 rounded-full text-sm font-semibold", s.rules === r ? "bg-card shadow" : "text-muted-foreground")} data-testid={`tab-rules-${r}`}>Part {r}</button>)}
      </div>
      <p className="text-xs text-muted-foreground">{s.rules === "117" ? "Part 121 passenger flights (flight duty period, Tables A and B), unaugmented crew." : s.rules === "135" ? "Part 135 unscheduled, one or two pilots (135.267)." : "Part 91 and anything flown under company limits."}</p>

      <section className="space-y-3 rounded-2xl border border-card-border bg-card p-4">
        <p className="text-[11px] text-muted-foreground">Enter every time on the same clock: local where you report{s.rules === "117" ? " (acclimated)" : ""}, or Zulu.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Report date"><input type="date" value={s.reportDate} onChange={(e) => set({ reportDate: e.target.value })} className={inp} data-testid="input-report-date" /></Field>
          <Field label="Report time"><input type="time" value={s.reportTime} onChange={(e) => set({ reportTime: e.target.value })} className={inp} data-testid="input-report-time" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Last release date" hint="End of your previous duty"><input type="date" value={s.relDate || ""} onChange={(e) => set({ relDate: e.target.value })} className={inp} data-testid="input-release-date" /></Field>
          <Field label="Last release time"><input type="time" value={s.relTime || ""} onChange={(e) => set({ relTime: e.target.value })} className={inp} data-testid="input-release-time" /></Field>
        </div>
        {s.rules === "117" && <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Flight segments"><input type="number" min={1} max={10} value={s.segments ?? 1} onChange={(e) => set({ segments: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className={inp} data-testid="input-segments" /></Field>
            <Field label="Planned flight time (h)"><input type="number" min={0} step={0.1} value={s.flightHours ?? ""} onChange={(e) => set({ flightHours: numOrU(e.target.value) })} className={inp} data-testid="input-flight" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="FDP last 168 h" hint="Optional, before this duty"><input type="number" min={0} step={0.1} value={s.fdp168 ?? ""} onChange={(e) => set({ fdp168: numOrU(e.target.value) })} className={inp} /></Field>
            <Field label="Flight time last 672 h" hint="Optional"><input type="number" min={0} step={0.1} value={s.flight672 ?? ""} onChange={(e) => set({ flight672: numOrU(e.target.value) })} className={inp} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.off30 ?? false} onChange={(e) => set({ off30: e.target.checked })} className="h-5 w-5" />I've had 30 hours in a row off in the last 7 days</label>
        </>}
        {s.rules === "135" && <div className="grid grid-cols-2 gap-2">
          <Field label="Pilots"><select value={s.pilots ?? 2} onChange={(e) => set({ pilots: Number(e.target.value) as 1 | 2 })} className={inp} data-testid="select-pilots"><option value={1}>One pilot</option><option value={2}>Two pilots</option></select></Field>
          <Field label="Flight time in 24 h (h)" hint="This trip plus any other commercial flying"><input type="number" min={0} step={0.1} value={s.flight24 ?? ""} onChange={(e) => set({ flight24: numOrU(e.target.value) })} className={inp} data-testid="input-flight24" /></Field>
        </div>}
        {s.rules === "91" && <div className="grid grid-cols-2 gap-2">
          <Field label="Company max duty (h)"><input type="number" min={1} max={24} step={0.5} value={s.companyDuty ?? 14} onChange={(e) => set({ companyDuty: Number(e.target.value) || 14 })} className={inp} /></Field>
          <Field label="Company min rest (h)"><input type="number" min={0} max={24} step={0.5} value={s.companyRest ?? 10} onChange={(e) => set({ companyRest: Number(e.target.value) || 10 })} className={inp} /></Field>
        </div>}
      </section>

      {out && <section className={cn("rounded-2xl p-4 text-white", bad ? "bg-[#4a1515]" : "bg-[#0B1222]")} data-testid="card-duty-result">
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Duty must end by</p><p className="mt-0.5 font-code text-xl font-bold" data-testid="text-duty-ends">{show(out.dutyEnds)}</p><p className="text-xs text-white/60">{out.maxDuty} h {s.rules === "117" ? "FDP" : "duty"}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Earliest next report</p><p className="mt-0.5 font-code text-xl font-bold" data-testid="text-next-report">{show(out.nextReport)}</p><p className="text-xs text-white/60">if released at the limit</p></div>
        </div>
        {out.maxFlight != null && <p className="mt-3 text-sm">Max flight time: <span className="font-semibold">{out.maxFlight} h</span></p>}
        {out.checks.length > 0 && <ul className="mt-3 space-y-1.5">{out.checks.map((c, i) => (
          <li key={i} className="flex gap-2 text-sm" data-testid={`check-${i}`}>{c.ok === true ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : c.ok === false ? <XCircle className="h-4 w-4 shrink-0 text-red-400" /> : <CircleHelp className="h-4 w-4 shrink-0 text-amber-300" />}
            <span><span className="font-semibold">{c.label}.</span> <span className="text-white/75">{c.detail}</span></span></li>))}</ul>}
        <p className="mt-3 border-t border-white/15 pt-2 text-[11px] text-white/60">{out.basis}</p>
      </section>}
      <p className="text-[11px] text-muted-foreground">Sources: <a className="underline" href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-117" target="_blank" rel="noreferrer">14 CFR Part 117</a>, <a className="underline" href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-135/subpart-F/section-135.267" target="_blank" rel="noreferrer">14 CFR 135.267</a>. Nothing you enter here leaves this device.</p>
    </div>
  );
}
