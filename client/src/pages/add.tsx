import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, Check, ChevronDown, LocateFixed, Loader2, MapPin, Search, AlertTriangle, PlaneLanding } from "lucide-react";
import { Link } from "wouter";
import { TIME_BUCKETS, type Airport, type Category, type SpotWithStats, type ReviewWithVotes } from "@shared/schema";
import { COST_LABELS, PACES, costOptions, paceOf, type PaceId } from "@shared/cost";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CAT_META, Chip } from "@/lib/ui";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useSearch } from "./home";
import { useAuth } from "@/lib/auth";
import { POINTS } from "@shared/tiers";
import { getPosition, milesBetween, type LatLng, type NearAirport, type PlaceHit } from "@/lib/geo";

const TIME_PRESETS: Record<string, number> = { quick: 30, short: 120, half: 300, day: 600, multi: 1440 };
const bucketFor = (min: number) => TIME_BUCKETS.find((b) => min <= b.max)?.id || "multi";
const FAR_MILES = 30; // a pick this far from the field probably belongs to another airport
const inputCls = "w-full h-11 rounded-xl border border-input bg-card px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring";
export const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^\d+: /, "").replace(/^\{"message":"|"\}$/g, "");

async function getJson<T>(url: string): Promise<T> {
  return (await apiRequest("GET", url)).json();
}

export default function AddPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search] = useSearch();
  const [, params] = useRoute("/add/:icao");
  const [isEdit, editParams] = useRoute("/spot/:id/edit");
  const editId = isEdit ? editParams!.id : undefined;
  const initialIcao = (params?.icao || "").toUpperCase();
  const { data: editData } = useQuery<{ spot: SpotWithStats; reviews: ReviewWithVotes[] }>({ queryKey: ["/api/spots", editId], enabled: !!editId });
  const [loaded, setLoaded] = useState(false);

  const [category, setCategory] = useState<Category>(search.category || "eat");
  const [code, setCode] = useState(initialIcao);
  const [city, setCity] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [costLevel, setCost] = useState<number | null>(null);
  const [pace, setPace] = useState<PaceId | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [miles, setMiles] = useState("");
  const [crewTip, setCrewTip] = useState("");
  const [more, setMore] = useState(false);
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [tags, setTags] = useState("");
  const [place, setPlace] = useState<PlaceHit | null>(null); // chosen autofill result
  const [here, setHere] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [nearMsg, setNearMsg] = useState("");
  const { me, requireAuth } = useAuth();

  // edit mode: load the listing once
  useEffect(() => {
    const s = editData?.spot;
    if (!s || loaded) return;
    setCategory(s.category as Category); setCode(s.icao); setName(s.name); setDescription(s.description || "");
    setCost(s.category === "fbo" ? null : s.costLevel); setPace((s.pace as PaceId) || (s.category === "eat" ? paceOf(s) : null));
    setTime(s.category === "do" ? bucketFor(s.minutesNeeded) : null); setMiles(s.milesFromField ? String(s.milesFromField) : "");
    setCrewTip(s.crewTip || ""); setAddress(s.address || ""); setWebsite(s.website || "");
    try { setTags((JSON.parse(s.tags || "[]") as string[]).join(", ")); } catch { /* ignore */ }
    if (s.lat != null && s.lng != null) setPlace({ ref: s.placeRef || `saved:${s.id}`, name: s.name, address: s.address || "", lat: s.lat, lng: s.lng, kind: "", city: "" } as PlaceHit);
    if (s.address || s.website || s.tags !== "[]") setMore(true);
    setLoaded(true);
  }, [editData, loaded]);
  const notOwner = !!editData && !!me && editData.spot.userId !== me.id;

  // reset price when switching to a category where it isn't valid (e.g. Free for restaurants)
  useEffect(() => { if (costLevel != null && !costOptions(category).includes(costLevel)) setCost(null); }, [category]); // eslint-disable-line

  const c = code.trim().toUpperCase();
  const { data: airport, isFetching: apLoading, isError: apUnknown } = useQuery<Airport>({
    queryKey: ["/api/airports/lookup", c],
    queryFn: () => getJson<Airport>(`/api/airports/lookup/${c}`),
    enabled: c.length >= 3, retry: false, staleTime: 3600_000,
  });
  const resolved = c.length >= 3 && airport && !apUnknown ? airport : undefined;
  const unknown = c.length >= 3 && !apLoading && apUnknown;
  // Suggestions are centered on the selected airport (not on the poster), so a spot added after leaving town still lands in the right place.
  const field = useMemo(() => (resolved?.lat != null && resolved?.lon != null ? { lat: resolved.lat, lng: resolved.lon } : null), [resolved?.lat, resolved?.lon]);
  const anchor = field ?? here;
  const hereNearField = !!here && !!field && milesBetween({ lat: here.lat, lon: here.lng }, { lat: field.lat, lon: field.lng }) <= FAR_MILES;

  // miles from field: always measured from the selected airport
  const placeMiles = place && field ? Math.round(milesBetween({ lat: field.lat, lon: field.lng }, { lat: place.lat, lon: place.lng }) * 10) / 10 : null;
  useEffect(() => { if (placeMiles != null) setMiles(String(placeMiles)); }, [placeMiles]);
  const tooFar = placeMiles != null && placeMiles > FAR_MILES;

  async function useMyLocation() {
    setLocating(true); setNearMsg("");
    try {
      const pos = await getPosition();
      setHere(pos);
      const near = await getJson<NearAirport[]>(`/api/airports/nearest?lat=${pos.lat}&lon=${pos.lng}`);
      if (near[0]) {
        setCode(near[0].icao);
        setNearMsg(`${near[0].icao} · ${near[0].name} · ${near[0].miles} mi from you`);
      } else setNearMsg("No airport found near you. Type the code.");
    } catch (e) {
      toast({ title: "Location unavailable", description: errText(e), variant: "destructive" });
    } finally { setLocating(false); }
  }

  function choosePlace(p: PlaceHit) {
    setPlace(p);
    setName(p.name);
    if (p.address) setAddress(p.address);
    setMore(true);
  }

  const m = useMutation({
    mutationFn: async () =>
      (
        await apiRequest(editId ? "PATCH" : "POST", editId ? `/api/spots/${editId}` : "/api/spots", {
          icao: c,
          airportCity: unknown ? city : undefined,
          category,
          name,
          description,
          costLevel: category === "fbo" ? 0 : costLevel,
          pace: category === "eat" ? pace : null,
          minutesNeeded: category === "do" && time ? TIME_PRESETS[time] : category === "stay" ? 720 : 30,
          milesFromField: miles ? Number(miles) : 0,
          lat: place?.lat ?? null, lng: place?.lng ?? null, placeRef: place?.ref ?? null,
          crewTip, address, website, tags,
        })
      ).json(),
    onSuccess: (spot: { id: number; status: string }) => {
      for (const k of ["/api/search", "/api/airports", "/api/me", "/api/crew", "/api/highlights", "/api/spots", "/api/me/favorites", "/api/briefings"]) queryClient.invalidateQueries({ queryKey: [k] });
      if (editId) { toast({ title: "Listing updated" }); navigate(`/spot/${spot.id}`); return; }
      toast({ title: spot.status === "pending" ? "Submitted for review" : "Spot added — thanks for helping the next crew" });
      navigate(spot.status === "pending" ? "/" : `/spot/${spot.id}`);
    },
    onError: (e: Error) => toast({ title: editId ? "Couldn't save changes" : "Couldn't add spot", description: errText(e), variant: "destructive" }),
  });

  const needsCost = category !== "fbo";
  const missing = [
    name.trim().length < 2 && "name",
    c.length < 3 && "airport",
    unknown && !city.trim() && "city",
    needsCost && costLevel == null && "price",
    category === "eat" && !pace && "Grab & go or Sit-down",
    category === "do" && !time && "time needed",
  ].filter(Boolean) as string[];
  const canSubmit = missing.length === 0 && !notOwner && (!editId || loaded);

  if (editId && notOwner) return <p className="text-sm text-muted-foreground">Only the crew member who posted this listing can edit it. <Link href={`/spot/${editId}`} className="text-primary underline">Back to the listing</Link></p>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) requireAuth(() => m.mutate(), editId ? "Sign in to edit your listing." : `Sign in to add this spot and earn ${POINTS.listing} points.`); }} className="space-y-6" data-testid="form-add">
      <header>
        {editId && <Link href={`/spot/${editId}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-spot"><ArrowLeft className="h-4 w-4" /> Listing</Link>}
        <h1 className="text-xl font-semibold">{editId ? "Edit your listing" : "Add a spot"}</h1>
        <p className="text-sm text-muted-foreground mt-1">{editId ? "Fix anything that's wrong. Ratings, votes and points stay as they are." : "Start typing the name and pick it from the list — we fill in the address and distance."}</p>
        {!editId && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium" data-testid="text-add-points">
            +{POINTS.listing} pts · +{POINTS.listingVetted} more when crews vet it{me ? "" : " · sign-in required"}
          </p>
        )}
      </header>

      <Field n={1} label="What kind of spot?">
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(CAT_META) as Category[]).map((k) => {
            const I = CAT_META[k].icon;
            return (
              <button type="button" key={k} onClick={() => setCategory(k)} data-testid={`button-add-cat-${k}`}
                className={cn("rounded-xl border p-2.5 flex flex-col items-center gap-1 text-xs font-medium", category === k ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card hover-elevate text-muted-foreground")}>
                <I className={cn("h-5 w-5", category === k && "text-primary")} />
                {CAT_META[k].label}
              </button>
            );
          })}
        </div>
        {category === "fbo" && <p className="mt-2 text-xs text-muted-foreground">FBO is for the FBO itself. A restaurant on the field goes under Eat.</p>}
      </Field>

      <Field n={2} label="Airport" hint="MIA, KMIA, X51 or 06FA">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)); setNearMsg(""); }} placeholder="KOPF" autoCapitalize="characters" autoCorrect="off" data-testid="input-add-icao"
              className={cn(inputCls, "font-code tracking-widest uppercase pr-28")} />
            {resolved && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground truncate max-w-[50%] inline-flex items-center gap-1" data-testid="text-add-resolved"><Check className="h-3.5 w-3.5 text-primary shrink-0" /><span className="truncate">{resolved.city}</span></span>}
          </div>
          <button type="button" onClick={useMyLocation} disabled={locating} data-testid="button-add-locate"
            className="h-11 shrink-0 rounded-xl border border-border bg-card px-3 text-sm font-medium inline-flex items-center gap-1.5 hover-elevate disabled:opacity-60">
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-primary" />}
            <span className="hidden min-[400px]:inline">Use my location</span><span className="min-[400px]:hidden">Locate</span>
          </button>
        </div>
        {nearMsg && <p className="mt-1.5 text-xs text-muted-foreground" data-testid="text-add-near">{nearMsg}</p>}
        {resolved && !nearMsg && <p className="mt-1.5 text-xs text-muted-foreground" data-testid="text-add-airport">{resolved.name}{resolved.city ? ` · ${resolved.city}` : ""}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">Posting after you've left? Enter the airport you were at. Distances are measured from that field, not from where you are now.</p>
        {unknown && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1">We couldn't find {c}. What city is it in?</p>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" data-testid="input-add-city" className={inputCls} />
          </div>
        )}
      </Field>

      <Field n={3} label="Name">
        <PlaceAutocomplete value={name} onChange={(v) => { setName(v); if (place && v !== place.name) setPlace(null); }} onPick={choosePlace}
          anchor={anchor} category={category} here={hereNearField ? here : null} field={field} code={resolved?.icao || c}
          placeholder={category === "fbo" ? "e.g. Signature Aviation OPF" : category === "stay" ? "e.g. Hampton Inn Miami Lakes" : "e.g. Versailles Restaurant"} />
        {place && (
          <p className="mt-1.5 text-xs text-muted-foreground inline-flex items-start gap-1" data-testid="text-add-place">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>{place.address || "Location set"}{placeMiles != null ? ` · ${placeMiles} mi from ${resolved?.icao || c}` : ""}</span>
          </p>
        )}
        {tooFar && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-orange-500/10 p-2 text-xs" data-testid="text-add-far">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-orange-600 dark:text-orange-400" />
            <span>That's {placeMiles} mi from {resolved?.icao || c}. If it's near a different airport, change the airport above.</span>
          </p>
        )}
      </Field>

      {needsCost && (
        <Field n={4} label="Price" hint={category === "do" ? "per person" : category === "stay" ? "per night" : "per person"}>
          <div className="flex gap-2 flex-wrap">
            {costOptions(category).map((i) => <Chip key={i} active={costLevel === i} onClick={() => setCost(i)} testId={`chip-add-cost-${i}`} className="font-code">{COST_LABELS[i]}</Chip>)}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Crews who rate it add their own price — the listing shows the crew's typical price.</p>
        </Field>
      )}
      {category === "eat" && (
        <Field n={5} label="Grab & go or sit-down?">
          <div className="flex gap-2">
            {PACES.map((p) => <Chip key={p.id} active={pace === p.id} onClick={() => setPace(p.id)} testId={`chip-add-pace-${p.id}`}>{p.label}</Chip>)}
          </div>
        </Field>
      )}
      {category === "do" && (
        <Field n={5} label="Time it takes" hint="not counting travel">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {TIME_BUCKETS.map((b) => <Chip key={b.id} active={time === b.id} onClick={() => setTime(b.id)} testId={`chip-add-time-${b.id}`}>{b.sub}</Chip>)}
          </div>
        </Field>
      )}

      <div className="space-y-5 rounded-2xl border border-card-border bg-card/60 p-4">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} data-testid="input-add-description"
          placeholder={category === "fbo" ? "Lounge, snooze rooms, crew car, fees, service — the real story." : "Why it's worth it, what to order, what to skip."}
          className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Miles from {resolved?.icao || "the field"} {placeMiles != null ? "(measured from the airport)" : ""}</p>
          <input inputMode="decimal" value={miles} readOnly={placeMiles != null} onChange={(e) => setMiles(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 = on field" data-testid="input-add-miles" className={cn(inputCls, placeMiles != null && "bg-muted/50 text-muted-foreground")} />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Crew tip</p>
          <input value={crewTip} onChange={(e) => setCrewTip(e.target.value)} placeholder="Crew discount, best time to go, call ahead…" data-testid="input-add-tip" className={inputCls} />
        </div>

        <button type="button" onClick={() => setMore(!more)} data-testid="button-add-more" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} /> Address, website, tags
        </button>
        {more && (
          <div className="space-y-3">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" data-testid="input-add-address" className={inputCls} />
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" inputMode="url" data-testid="input-add-website" className={inputCls} />
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated — late night, crew discount" data-testid="input-add-tags" className={inputCls} />
          </div>
        )}
      </div>

      <div className="sticky bottom-20 sm:bottom-4 z-10">
        {!canSubmit && (name || code) && <p className="mb-2 text-center text-xs text-muted-foreground" data-testid="text-add-missing">Still needed: {missing.join(", ")}</p>}
        <button type="submit" disabled={!canSubmit || m.isPending} data-testid="button-submit-spot"
          className="w-full h-12 rounded-full taxi-sign text-base font-semibold shadow-lg disabled:opacity-50 hover-elevate">
          {m.isPending ? (editId ? "Saving…" : "Adding…") : editId ? "Save changes" : me ? `Add spot · +${POINTS.listing} pts` : "Sign in & add spot"}
        </button>
      </div>
    </form>
  );
}

/** Name field with OpenStreetMap suggestions near the airport (or the user's location). */
function PlaceAutocomplete({ value, onChange, onPick, anchor, category, here, field, code, placeholder }: {
  value: string; onChange: (v: string) => void; onPick: (p: PlaceHit) => void; anchor: LatLng | null; category: Category;
  here: LatLng | null; field: LatLng | null; code: string; placeholder: string;
}) {
  const [nearLabel, setNearLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"search" | "nearby">("search");
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // type-ahead (debounced)
  useEffect(() => {
    if (mode !== "search") return;
    const q = value.trim();
    if (!anchor || q.length < 3) { setHits([]); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true); setNote("");
      try {
        const r = await getJson<PlaceHit[]>(`/api/places/search?q=${encodeURIComponent(q)}&lat=${anchor.lat}&lng=${anchor.lng}&cat=${category}`);
        if (my === seq.current) { setHits(r); if (!r.length) setNote("No matches on the map — just type it in."); }
      } catch (e) { if (my === seq.current) { setHits([]); setNote(errText(e)); } }
      finally { if (my === seq.current) setBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [value, anchor?.lat, anchor?.lng, category, mode]); // eslint-disable-line

  async function showNearby(at: LatLng, label: string) {
    setMode("nearby"); setOpen(true); setBusy(true); setNote(""); setNearLabel(label);
    const my = ++seq.current;
    try {
      const r = await getJson<PlaceHit[]>(`/api/places/nearby?lat=${at.lat}&lng=${at.lng}&cat=${category}`);
      if (my === seq.current) { setHits(r); if (!r.length) setNote("Nothing mapped right there. Type the name instead."); }
    } catch (e) { if (my === seq.current) { setHits([]); setNote(errText(e)); } }
    finally { if (my === seq.current) setBusy(false); }
  }

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input value={value} onChange={(e) => { onChange(e.target.value); setMode("search"); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={placeholder} autoComplete="off" data-testid="input-add-name" className={cn(inputCls, "pl-9 pr-9")} />
        {busy && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {(field || here) && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {field && (
            <button type="button" onClick={() => showNearby(field, `Near ${code}`)} data-testid="button-add-near-field" className="text-xs font-medium text-primary inline-flex items-center gap-1">
              <PlaneLanding className="h-3.5 w-3.5" /> {category === "stay" ? "Hotels" : category === "eat" ? "Food" : category === "fbo" ? "Places" : "Things to do"} near {code}
            </button>
          )}
          {here && (
            <button type="button" onClick={() => showNearby(here, "Closest to you")} data-testid="button-add-nearby" className="text-xs font-medium text-primary inline-flex items-center gap-1">
              <LocateFixed className="h-3.5 w-3.5" /> Near me
            </button>
          )}
        </div>
      )}
      {!anchor && <p className="mt-1.5 text-[11px] text-muted-foreground">Enter the airport (or use your location) to get name suggestions.</p>}
      {open && (hits.length > 0 || note) && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl overflow-hidden" data-testid="list-place-hits">
          {mode === "nearby" && <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{nearLabel}</p>}
          {hits.map((h) => (
            <button type="button" key={h.ref} onClick={() => { onPick(h); setOpen(false); }} data-testid={`button-place-${h.ref}`}
              className="w-full text-left px-3 py-2.5 hover-elevate border-b border-border/60 last:border-0">
              <span className="block text-sm font-medium truncate">{h.name}</span>
              <span className="block text-xs text-muted-foreground truncate">{[h.kind, h.address].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {note && <p className="px-3 py-2.5 text-xs text-muted-foreground">{note}</p>}
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/40">Suggestions © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a> contributors</p>
        </div>
      )}
    </div>
  );
}

function Field({ n, label, hint, children }: { n: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="font-code text-[11px] font-bold text-primary">0{n}</span>
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
