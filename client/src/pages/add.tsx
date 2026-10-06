import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Check, ChevronDown } from "lucide-react";
import { TIME_BUCKETS, type Airport, type Category } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CAT_META, COST_LABELS, Chip } from "@/lib/ui";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useSearch } from "./home";
import { useAuth } from "@/lib/auth";
import { POINTS } from "@shared/tiers";

const TIME_PRESETS: Record<string, number> = { quick: 30, short: 120, half: 300, day: 600, multi: 1440 };
const inputCls = "w-full h-11 rounded-xl border border-input bg-card px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export default function AddPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search] = useSearch();
  const [, params] = useRoute("/add/:icao");
  const initialIcao = (params?.icao || "").toUpperCase();
  const { data: airports } = useQuery<Airport[]>({ queryKey: ["/api/airports"] });

  const [category, setCategory] = useState<Category>(search.category || "eat");
  const [code, setCode] = useState(initialIcao);
  const [city, setCity] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [costLevel, setCost] = useState(1);
  const [time, setTime] = useState("short");
  const [miles, setMiles] = useState("");
  const [crewTip, setCrewTip] = useState("");
  const [more, setMore] = useState(false);
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [tags, setTags] = useState("");
  const { me, requireAuth } = useAuth();

  const resolved = useMemo(() => {
    const c = code.trim().toUpperCase();
    if (!airports || c.length < 3) return undefined;
    return airports.find((a) => a.icao === c || a.iata === c || (c.length === 3 && a.icao === "K" + c));
  }, [code, airports]);
  const unknown = code.trim().length >= 3 && airports && !resolved;

  const m = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/spots", {
          icao: code.trim().toUpperCase(),
          airportCity: unknown ? city : undefined,
          category,
          name,
          description,
          costLevel: category === "fbo" ? 0 : costLevel,
          minutesNeeded: category === "stay" ? 720 : category === "fbo" ? 30 : TIME_PRESETS[time],
          milesFromField: miles ? Number(miles) : 0,
          crewTip,
          address,
          website,
          tags,
        })
      ).json(),
    onSuccess: (spot: { id: number; status: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/airports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crew"] });
      toast({ title: spot.status === "pending" ? "Submitted for review" : "Spot added — thanks for helping the next crew" });
      navigate(spot.status === "pending" ? "/" : `/spot/${spot.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't add spot", description: e.message.replace(/^\d+: /, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });

  const canSubmit = name.trim().length >= 2 && code.trim().length >= 3 && (!unknown || city.trim());

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) requireAuth(() => m.mutate(), `Sign in to add this spot and earn ${POINTS.listing} points.`); }} className="space-y-6" data-testid="form-add">
      <header>
        <h1 className="text-xl font-semibold">Add a spot</h1>
        <p className="text-sm text-muted-foreground mt-1">Three fields and you're done. Everything else is optional.</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium" data-testid="text-add-points">
          +{POINTS.listing} pts · +{POINTS.listingVetted} more when crews vet it{me ? "" : " · sign-in required"}
        </p>
      </header>

      <Field n={1} label="What kind of spot?">
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(CAT_META) as Category[]).map((c) => {
            const I = CAT_META[c].icon;
            return (
              <button type="button" key={c} onClick={() => setCategory(c)} data-testid={`button-add-cat-${c}`}
                className={cn("rounded-xl border p-2.5 flex flex-col items-center gap-1 text-xs font-medium", category === c ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card hover-elevate text-muted-foreground")}>
                <I className={cn("h-5 w-5", category === c && "text-primary")} />
                {CAT_META[c].label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field n={2} label="Airport" hint="IATA or ICAO — MIA or KMIA">
        <div className="relative">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))} placeholder="KOPF" autoCapitalize="characters" autoCorrect="off" data-testid="input-add-icao"
            className={cn(inputCls, "font-code tracking-widest uppercase pr-28")} />
          {resolved && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground truncate max-w-[45%] inline-flex items-center gap-1" data-testid="text-add-resolved"><Check className="h-3.5 w-3.5 text-primary" />{resolved.city}</span>}
        </div>
        {unknown && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1">New airfield to us — what city is it in?</p>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" data-testid="input-add-city" className={inputCls} />
          </div>
        )}
      </Field>

      <Field n={3} label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={category === "fbo" ? "e.g. Signature Aviation OPF" : "e.g. Versailles Restaurant"} data-testid="input-add-name" className={inputCls} />
      </Field>

      <div className="space-y-5 rounded-2xl border border-card-border bg-card/60 p-4">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} data-testid="input-add-description"
          placeholder={category === "fbo" ? "Lounge, snooze rooms, crew car, fees, service — the real story." : "Why it's worth it, what to order, what to skip."}
          className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring" />

        {category !== "fbo" && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Cost</p>
            <div className="flex gap-2 flex-wrap">
              {COST_LABELS.map((l, i) => <Chip key={l} active={costLevel === i} onClick={() => setCost(i)} testId={`chip-add-cost-${i}`} className="font-code">{l}</Chip>)}
            </div>
          </div>
        )}
        {(category === "eat" || category === "do") && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Time it takes (not counting travel)</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {TIME_BUCKETS.map((b) => <Chip key={b.id} active={time === b.id} onClick={() => setTime(b.id)} testId={`chip-add-time-${b.id}`}>{b.sub}</Chip>)}
            </div>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Miles from field</p>
          <input inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0 = on field" data-testid="input-add-miles" className={inputCls} />
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
        <button type="submit" disabled={!canSubmit || m.isPending} data-testid="button-submit-spot"
          className="w-full h-12 rounded-full taxi-sign text-base font-semibold shadow-lg disabled:opacity-50 hover-elevate">
          {m.isPending ? "Adding…" : me ? `Add spot · +${POINTS.listing} pts` : "Sign in & add spot"}
        </button>
      </div>
    </form>
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
