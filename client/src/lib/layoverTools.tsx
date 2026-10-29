// Layover tools (admins first, layover_tools_audience): delay/closure banner, TAF + 10-day forecast, abroad card,
// crew hotel sheet with one-tap shuttle call.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, Check, ChevronDown, Globe2, Phone, Pencil, ShieldPlus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useLayoverTools } from "@/lib/experience";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { HOTEL_AMENITIES, PHONE_RE, telHref, wxWord, EMBASSY_URL, ADVISORY_URL, STEP_URL, type HotelSheet, type LayoverToolsResp } from "@shared/layoverTools";

const AdminsOnly = () => <span className="rounded bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Admins only</span>;
const ago = (t: number) => { const d = Math.floor((Date.now() - t) / 86_400_000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`; };

export function useLayoverToolsData(icao: string | null | undefined) {
  const g = useLayoverTools();
  return useQuery<LayoverToolsResp>({ queryKey: ["/api/layover-tools", icao], enabled: g.on && !!icao, staleTime: 3 * 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/layover-tools/${icao}`)).json() });
}

/** Ground stops, delay programs, delays and closures at this field (FAA NAS status). Nothing shows when it's quiet. */
export function NasBanner({ icao, compact }: { icao: string; compact?: boolean }) {
  const q = useLayoverToolsData(icao);
  const ev = q.data?.nas || [];
  if (!ev.length) return null;
  return (
    <section className={cn("rounded-2xl border p-3", ev.some((e) => e.kind === "ground_stop" || e.kind === "closure" && !/PPR/.test(e.title)) ? "border-red-500/40 bg-red-500/10" : "border-amber-500/40 bg-amber-500/10")} data-testid={`banner-nas-${icao}`}>
      {ev.map((e, i) => (
        <div key={i} className={cn("flex gap-2 text-sm", i && "mt-2 border-t border-border/50 pt-2")}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="font-semibold">{e.title} <span className="font-code text-xs">{e.icao}</span></p>
            {e.detail && <p className="text-xs">{e.detail}</p>}
            {!compact && e.reason && <p className="mt-0.5 break-words text-xs text-muted-foreground">{e.reason}</p>}
          </div>
        </div>
      ))}
      <p className="mt-2 text-[10px] text-muted-foreground">FAA NAS status (nasstatus.faa.gov). Check NOTAMs and your dispatcher before you go.</p>
    </section>
  );
}

/** TAF + 10-day forecast. */
export function ForecastCard({ icao, tz }: { icao: string; tz?: string | null }) {
  const g = useLayoverTools();
  const q = useLayoverToolsData(icao);
  const [taf, setTaf] = useState(false);
  const f = q.data?.forecast;
  if (!g.on || (!f && !q.data?.taf)) return null;
  const dow = (d: string) => { const x = new Date(d + "T12:00:00Z"); return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(x); };
  return (
    <section className="rounded-2xl border border-card-border bg-card" data-testid="card-forecast">
      <div className="flex items-center justify-between gap-2 px-4 pt-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarRange className="h-4 w-4" />10-day forecast</h2>{g.adminOnly && <AdminsOnly />}</div>
      {f && <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 pt-2" data-testid="list-forecast">
        {f.map((d, i) => (
          <div key={d.date} className="w-[64px] shrink-0 rounded-xl bg-muted/60 px-1.5 py-2 text-center" data-testid={`day-forecast-${i}`}>
            <p className="text-[11px] font-semibold">{i === 0 ? "Today" : dow(d.date)}</p>
            <p className="mt-1 text-sm font-semibold tabular">{d.hiF}°</p>
            <p className="text-[11px] text-muted-foreground tabular">{d.loF}°</p>
            <p className="mt-1 truncate text-[10px] leading-tight text-muted-foreground" title={wxWord(d.code)}>{wxWord(d.code)}</p>
            {d.pop != null && d.pop >= 20 && <p className="text-[10px] font-semibold text-sky-700 dark:text-sky-300">{d.pop}%</p>}
          </div>
        ))}
      </div>}
      {q.data?.taf && <div className="border-t border-border px-4 py-2.5">
        <button type="button" onClick={() => setTaf(!taf)} className="flex w-full items-center justify-between text-xs font-semibold" aria-expanded={taf} data-testid="button-taf">TAF {icao}<ChevronDown className={cn("h-4 w-4 transition-transform", taf && "rotate-180")} /></button>
        {taf && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted px-2.5 py-2 font-code text-[11px] leading-relaxed" data-testid="text-taf">{q.data.taf.raw.replace(/ (FM\d{6}|TEMPO|BECMG|PROB\d{2})/g, "\n  $1")}</p>}
      </div>}
      <p className="px-4 pb-3 text-[10px] text-muted-foreground">Forecast: Open-Meteo. TAF: aviationweather.gov.{tz ? "" : ""}</p>
    </section>
  );
}

/** Abroad: local emergency numbers, US embassy directory, State Department advisories. */
export function AbroadCard({ icao }: { icao: string }) {
  const g = useLayoverTools();
  const q = useLayoverToolsData(icao);
  const a = q.data?.abroad;
  if (!g.on || !a) return null;
  const nums = [["Police", a.police], ["Fire", a.fire], ["Ambulance", a.ambulance]] as const;
  const same = a.police && a.police === a.fire && a.fire === a.ambulance;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-abroad">
      <div className="flex items-center gap-2"><Globe2 className="h-4 w-4" /><h2 className="text-sm font-semibold">Abroad in {a.countryName}</h2>{g.adminOnly && <AdminsOnly />}</div>
      {a.police ? (
        <div className="mt-2">
          {same ? <a href={telHref(a.police)} className="flex items-center justify-between rounded-xl bg-red-600 px-3 py-2.5 text-white" data-testid="link-abroad-emergency"><span className="text-sm font-semibold">Emergency (police, fire, ambulance)</span><span className="font-code text-lg font-bold">{a.police}</span></a>
            : <div className="grid grid-cols-3 gap-1.5">{nums.map(([l, n]) => n && <a key={l} href={telHref(n)} className="rounded-xl bg-red-600 px-2 py-2 text-center text-white" data-testid={`link-abroad-${l.toLowerCase()}`}><span className="block text-[11px]">{l}</span><span className="font-code text-lg font-bold">{n}</span></a>)}</div>}
          {a.note && <p className="mt-1.5 text-xs text-muted-foreground">{a.note}</p>}
        </div>
      ) : <p className="mt-2 text-sm text-muted-foreground">We don't have local emergency numbers for {a.countryName} on file. Ask your hotel or FBO desk when you arrive.</p>}
      <ul className="mt-3 space-y-1.5 text-sm">
        <li><a href={EMBASSY_URL} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2" data-testid="link-abroad-embassy">Find the US embassy or consulate</a></li>
        <li><a href={ADVISORY_URL} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">State Department travel advisory</a></li>
        <li><a href={STEP_URL} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">Enroll the trip in STEP</a></li>
      </ul>
      <p className="mt-2 text-[10px] text-muted-foreground">Confirm numbers with your hotel or FBO. Not a US citizen? Look up your own country's embassy.</p>
    </section>
  );
}

function useSheets(ids: number[]) {
  const g = useLayoverTools();
  const key = ids.filter((x) => x > 0).sort((a, b) => a - b).join(",");
  return useQuery<{ on: boolean; sheets: Record<number, HotelSheet> }>({ queryKey: ["/api/hotel-sheet", key], enabled: g.on && !!key, staleTime: 60_000, retry: false,
    queryFn: async () => (await apiRequest("GET", `/api/hotel-sheet?ids=${key}`)).json() });
}

/** One-tap shuttle call for the hotels on your trip sheet here. */
export function ShuttleCalls({ hotels }: { hotels: { id: number; name: string }[] }) {
  const q = useSheets(hotels.map((h) => h.id));
  const list = hotels.map((h) => ({ ...h, s: q.data?.sheets?.[h.id] })).filter((h) => h.s?.shuttlePhone);
  if (!list.length) return null;
  return (
    <div className="space-y-1.5" data-testid="list-shuttle-calls">
      {list.map((h) => (
        <a key={h.id} href={telHref(h.s!.shuttlePhone!)} className="flex items-center gap-3 rounded-2xl taxi-sign px-4 py-3 hover-elevate" data-testid={`link-call-shuttle-${h.id}`}>
          <Phone className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Call the shuttle</span><span className="block truncate text-xs opacity-80">{h.name}{h.s!.shuttleNote ? ` · ${h.s!.shuttleNote}` : ""}</span></span>
          <span className="font-code text-xs font-semibold">{h.s!.shuttlePhone}</span>
        </a>
      ))}
    </div>
  );
}

/** Crew hotel sheet on a hotel's page: shuttle phone and van notes, amenity chips, crew-confirmed date. */
export function HotelSheetCard({ spotId, name }: { spotId: number; name: string }) {
  const g = useLayoverTools();
  const { me } = useAuth();
  const { toast } = useToast();
  const q = useSheets([spotId]);
  const s = q.data?.sheets?.[spotId];
  const [edit, setEdit] = useState(false);
  const [phone, setPhone] = useState(""); const [note, setNote] = useState("");
  const [am, setAm] = useState<Record<string, "yes" | "no" | "">>({});
  const save = useMutation({
    mutationFn: async (body: any) => (await apiRequest("POST", `/api/hotel-sheet/${spotId}`, body)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/hotel-sheet"] }); setEdit(false); toast({ title: "Thanks, crews will see it" }); },
    onError: (e: any) => toast({ title: String(e?.message || "Couldn't save").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });
  if (!g.on) return null;
  const open = () => { setPhone(s?.shuttlePhone || ""); setNote(s?.shuttleNote || ""); setAm({ ...(s?.amenities || {}) } as any); setEdit(true); };
  const yes = HOTEL_AMENITIES.filter((a) => s?.amenities[a.id] === "yes"), no = HOTEL_AMENITIES.filter((a) => s?.amenities[a.id] === "no");
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4" data-testid="card-hotel-sheet">
      <div className="flex items-center gap-2"><ShieldPlus className="h-4 w-4" /><h2 className="text-sm font-semibold">Crew hotel sheet</h2>{g.adminOnly && <AdminsOnly />}
        {me && !edit && <button type="button" onClick={open} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary" data-testid="button-hotel-sheet-edit"><Pencil className="h-3.5 w-3.5" />{s ? "Update" : "Add details"}</button>}</div>
      {!edit && <>
        {s?.shuttlePhone ? (
          <a href={telHref(s.shuttlePhone)} className="mt-3 flex items-center gap-3 rounded-xl taxi-sign px-4 py-3 hover-elevate" data-testid="link-hotel-shuttle">
            <Phone className="h-5 w-5" /><span className="flex-1 text-sm font-semibold">Call the shuttle</span><span className="font-code text-sm font-semibold">{s.shuttlePhone}</span>
          </a>
        ) : <p className="mt-2 text-sm text-muted-foreground">{s ? "No shuttle number yet." : `No crew details for ${name} yet. Stayed here? Add the shuttle number and what it has.`}</p>}
        {s?.shuttleNote && <p className="mt-2 text-sm"><span className="font-semibold">Van: </span>{s.shuttleNote}</p>}
        {(yes.length > 0 || no.length > 0) && <div className="mt-3 flex flex-wrap gap-1.5" data-testid="list-hotel-amenities">
          {yes.map((a) => <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-200"><Check className="h-3 w-3" />{a.label}</span>)}
          {no.map((a) => <span key={a.id} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground line-through">{a.label}</span>)}
        </div>}
        {s?.confirmedAt && <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Confirmed by {s.crews} crew{s.crews === 1 ? "" : "s"} · last {ago(s.confirmedAt)}</span>
          {me && <button type="button" onClick={() => save.mutate({ confirm: true })} disabled={save.isPending} className="rounded-full border border-border px-2.5 py-1 font-semibold text-foreground hover-elevate" data-testid="button-hotel-sheet-confirm">Still right</button>}
        </div>}
      </>}
      {edit && <div className="mt-3 space-y-3" data-testid="form-hotel-sheet">
        <label className="block text-xs font-semibold">Shuttle phone<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+1 201 555 0100" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid="input-shuttle-phone" /></label>
        <label className="block text-xs font-semibold">Van notes<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Every 30 min, call from door 4, last run 11 PM" className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid="input-shuttle-note" /></label>
        <div>
          <p className="text-xs font-semibold">What it has (tap once for yes, twice for no)</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{HOTEL_AMENITIES.map((a) => { const v = am[a.id] || ""; return (
            <button key={a.id} type="button" onClick={() => setAm({ ...am, [a.id]: v === "" ? "yes" : v === "yes" ? "no" : "" })} aria-pressed={v === "yes"}
              className={cn("rounded-full border px-2.5 py-1 text-xs", v === "yes" ? "border-emerald-600 bg-emerald-500/15 font-semibold" : v === "no" ? "border-border bg-muted text-muted-foreground line-through" : "border-border")} data-testid={`chip-amenity-${a.id}`}>{v === "yes" && <Check className="mr-0.5 inline h-3 w-3" />}{a.label}</button>); })}</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEdit(false)} className="h-10 flex-1 rounded-full border border-border text-sm font-semibold">Cancel</button>
          <button type="button" disabled={save.isPending} onClick={() => {
            if (phone.trim() && !PHONE_RE.test(phone.trim())) return toast({ title: "Check the phone number", variant: "destructive" });
            const ch: Record<string, string> = {}; for (const a of HOTEL_AMENITIES) if ((am[a.id] || "") !== ((s?.amenities as any)?.[a.id] || "")) ch[a.id] = am[a.id] || "";
            const body: any = { amenities: ch, confirm: true };
            if (phone.trim() !== (s?.shuttlePhone || "")) body.shuttlePhone = phone.trim();
            if (note.trim() !== (s?.shuttleNote || "")) body.shuttleNote = note.trim();
            save.mutate(body);
          }} className="h-10 flex-1 rounded-full taxi-sign text-sm font-semibold" data-testid="button-hotel-sheet-save">Save</button>
        </div>
        <p className="text-[10px] text-muted-foreground">Front desk or shuttle numbers only. No personal phone numbers.</p>
      </div>}
    </section>
  );
}
