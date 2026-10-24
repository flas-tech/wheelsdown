import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FBO_LIMITS, type FboAd } from "@shared/fbo";
import { api, get, fboQuery } from "./api";
import { useMe } from "./App";
import { Card, Counter, Empty, Field, PageHeader, Spinner, btn, btnGhost, btnPrimary, inputCls } from "./ui";

const SLOT_LABEL: Record<string, string> = { top: "Top banner", inline: "In search results", footer: "Footer" };
const refresh = () => { fboQuery.invalidateQueries({ queryKey: ["/api/fbo/ads"] }); fboQuery.invalidateQueries({ queryKey: ["/api/fbo/stats"] }); };

export function AdsPage() {
  const { me } = useMe();
  const { data: ads, isLoading } = useQuery<FboAd[]>({ queryKey: ["/api/fbo/ads"], queryFn: get("/api/fbo/ads") });
  const [editing, setEditing] = useState<Partial<FboAd> | null>(null);
  const { toast } = useToast();
  const patch = useMutation({ mutationFn: ({ id, ...b }: Partial<FboAd> & { id: number }) => api("PATCH", `/api/fbo/ads/${id}`, b), onSuccess: refresh, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) });
  const del = useMutation({ mutationFn: (id: number) => api("DELETE", `/api/fbo/ads/${id}`), onSuccess: refresh });
  const active = (ads || []).filter((a) => a.active).length;
  return (
    <>
      <PageHeader title="Ads" sub={<>Text ads shown to crews searching {me.account.icao} in Wheelsdown, labeled Sponsored. Free during the beta. Up to {FBO_LIMITS.activeAds} can run at once.</>}
        actions={<button className={btnPrimary} onClick={() => setEditing({ slot: "inline", cta: "Learn more", active: active < FBO_LIMITS.activeAds })} data-testid="button-add-ad"><Plus className="h-4 w-4" />New ad</button>} />
      {!me.adsServing && (
        <div className="mb-4 flex gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm" data-testid="text-ads-not-serving">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>FBO ads aren't showing in the crew app yet. Set them up now; they'll start running at {me.account.icao} when Wheelsdown switches FBO ads on.</p>
        </div>
      )}
      {isLoading ? <Spinner /> : !ads?.length ? <Empty title="No ads yet">Promote fuel specials, your crew lounge, or a partner hotel.</Empty> : (
        <div className="space-y-3">
          {ads.map((a) => (
            <Card key={a.id} className={cn("flex flex-wrap items-center gap-4", !a.active && "opacity-60")} data-testid={`card-ad-${a.id}`}>
              <div className="min-w-[240px] flex-1"><AdPreview ad={a} advertiser={me.account.name} /></div>
              <div className="text-right text-sm">
                <p className="tabular"><b>{a.impressions}</b> <span className="text-muted-foreground">impressions</span></p>
                <p className="tabular"><b>{a.clicks}</b> <span className="text-muted-foreground">clicks</span>{a.impressions ? <span className="text-muted-foreground"> · {((a.clicks / a.impressions) * 100).toFixed(1)}%</span> : null}</p>
                <p className="text-xs text-muted-foreground">{SLOT_LABEL[a.slot] || a.slot}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Switch checked={a.active} onCheckedChange={(v) => patch.mutate({ id: a.id, active: v })} aria-label="Running" data-testid={`switch-ad-${a.id}`} />
                <div className="flex"><button className={btnGhost} aria-label="Edit" onClick={() => setEditing(a)}><Pencil className="h-4 w-4" /></button><button className={btnGhost} aria-label="Delete" onClick={() => { if (confirm("Delete this ad?")) del.mutate(a.id); }}><Trash2 className="h-4 w-4" /></button></div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">Impressions and clicks are counted events, not unique people. Ads run only at your airport. Wheelsdown can pause any ad that misleads crews.</p>
      {editing && <AdDialog ad={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AdPreview({ ad, advertiser }: { ad: Partial<FboAd>; advertiser: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sponsored · {advertiser}</p>
      <p className="mt-0.5 font-semibold">{ad.headline || "Your headline"}</p>
      {ad.body && <p className="line-clamp-2 text-sm text-muted-foreground">{ad.body}</p>}
      <span className="mt-2 inline-block rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">{ad.cta || "Learn more"}</span>
    </div>
  );
}

function AdDialog({ ad, onClose }: { ad: Partial<FboAd>; onClose: () => void }) {
  const { me } = useMe();
  const [f, setF] = useState({ slot: ad.slot || "inline", headline: ad.headline || "", body: ad.body || "", cta: ad.cta || "Learn more", url: ad.url || me.account.website || "", active: ad.active ?? true });
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => (ad.id ? api("PATCH", `/api/fbo/ads/${ad.id}`, f) : api("POST", "/api/fbo/ads", f)),
    onSuccess: () => { refresh(); toast({ title: "Saved" }); onClose(); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{ad.id ? "Edit ad" : "New ad"}</DialogTitle></DialogHeader>
        <div className="grid gap-5 md:grid-cols-[1fr_240px]">
          <form id="ad-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Field label="Headline" hint={<Counter value={f.headline} max={FBO_LIMITS.headline} />}><input className={inputCls} value={f.headline} maxLength={FBO_LIMITS.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} placeholder="Jet A crew special this week" required data-testid="input-ad-headline" autoFocus /></Field>
            <Field label="Body (optional)" hint={<Counter value={f.body} max={FBO_LIMITS.body} />}><input className={inputCls} value={f.body} maxLength={FBO_LIMITS.body} onChange={(e) => setF({ ...f, body: e.target.value })} data-testid="input-ad-body" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Button"><input className={inputCls} value={f.cta} maxLength={FBO_LIMITS.cta} onChange={(e) => setF({ ...f, cta: e.target.value })} data-testid="input-ad-cta" /></Field>
              <Field label="Placement"><select className={inputCls} value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} data-testid="select-ad-slot">{Object.entries(SLOT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            </div>
            <Field label="Link when tapped"><input className={inputCls} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://yourfbo.com/specials" required data-testid="input-ad-url" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Running</label>
          </form>
          <div><p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p><AdPreview ad={f} advertiser={me.account.name} /><p className="mt-2 text-[11px] text-muted-foreground">Runs at {me.account.icao} only.</p></div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button form="ad-form" className={btnPrimary} disabled={!f.headline || !f.url || save.isPending} data-testid="button-save-ad">{save.isPending ? <Spinner /> : "Save"}</button></div>
      </DialogContent>
    </Dialog>
  );
}
