import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, TicketPercent } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FBO_CAT_LABEL, FBO_LIMITS, type FboOffer, type FboPlace } from "@shared/fbo";
import { api, get, fboQuery } from "./api";
import { Card, Empty, Field, PageHeader, Spinner, areaCls, btn, btnGhost, btnPrimary, inputCls, fmtDate, today } from "./ui";

const refresh = () => { fboQuery.invalidateQueries({ queryKey: ["/api/fbo/offers"] }); fboQuery.invalidateQueries({ queryKey: ["/api/fbo/stats"] }); };
const isLive = (o: FboOffer) => o.active && (!o.expiresOn || o.expiresOn >= today());

export function OffersPage() {
  const { data: offers, isLoading } = useQuery<FboOffer[]>({ queryKey: ["/api/fbo/offers"], queryFn: get("/api/fbo/offers") });
  const { data: places } = useQuery<FboPlace[]>({ queryKey: ["/api/fbo/places"], queryFn: get("/api/fbo/places") });
  const [editing, setEditing] = useState<Partial<FboOffer> | null>(null);
  const { toast } = useToast();
  const patch = useMutation({ mutationFn: ({ id, ...b }: Partial<FboOffer> & { id: number }) => api("PATCH", `/api/fbo/offers/${id}`, b), onSuccess: refresh, onError: (e: Error) => toast({ title: e.message, variant: "destructive" }) });
  const del = useMutation({ mutationFn: (id: number) => api("DELETE", `/api/fbo/offers/${id}`), onSuccess: refresh });
  const placeName = (id: number | null) => (id ? places?.find((p) => p.id === id)?.name : null);
  return (
    <>
      <PageHeader title="Discounts & coupons" sub="Crew discounts at the places you recommend, or at your own desk. Crews see the code on your page; the business honors it. Expired codes hide themselves."
        actions={<button className={btnPrimary} onClick={() => setEditing({ active: true })} data-testid="button-add-offer"><Plus className="h-4 w-4" />Add discount</button>} />
      {isLoading ? <Spinner /> : !offers?.length ? (
        <Empty title="No discounts yet">Add a code like CREW10, or a perk like "Show your crew badge for 15% off".</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {offers.map((o) => (
            <Card key={o.id} className={cn("flex gap-3", !isLive(o) && "opacity-60")} data-testid={`card-offer-${o.id}`}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15"><TicketPercent className="h-5 w-5 text-primary" /></div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{o.title}</p>
                <p className="text-xs text-muted-foreground">{placeName(o.placeId) || "General / at the FBO"}{o.expiresOn ? ` · through ${fmtDate(Date.parse(o.expiresOn + "T12:00:00"))}` : " · no end date"}</p>
                {o.code && <p className="mt-2 inline-block rounded-md border border-dashed border-primary px-2 py-0.5 font-code text-sm font-bold tracking-wider">{o.code}</p>}
                {o.details && <p className="mt-1 text-xs text-muted-foreground">{o.details}</p>}
                {o.expiresOn && o.expiresOn < today() && <p className="mt-1 text-xs font-medium text-destructive">Expired, hidden from crews</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Switch checked={o.active} onCheckedChange={(v) => patch.mutate({ id: o.id, active: v })} aria-label="Show to crews" data-testid={`switch-offer-${o.id}`} />
                <div className="flex"><button className={btnGhost} aria-label="Edit" onClick={() => setEditing(o)}><Pencil className="h-4 w-4" /></button><button className={btnGhost} aria-label="Delete" onClick={() => { if (confirm("Delete this discount?")) del.mutate(o.id); }}><Trash2 className="h-4 w-4" /></button></div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">Only post discounts the business has agreed to. Your page tells crews that offers are honored by the business or your FBO, not Wheelsdown. Up to {FBO_LIMITS.offers} during the beta.</p>
      {editing && <OfferDialog offer={editing} places={places || []} onClose={() => setEditing(null)} />}
    </>
  );
}

function OfferDialog({ offer, places, onClose }: { offer: Partial<FboOffer>; places: FboPlace[]; onClose: () => void }) {
  const [f, setF] = useState({ placeId: offer.placeId ?? null as number | null, title: offer.title || "", code: offer.code || "", details: offer.details || "", expiresOn: offer.expiresOn || "", active: offer.active ?? true });
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => (offer.id ? api("PATCH", `/api/fbo/offers/${offer.id}`, f) : api("POST", "/api/fbo/offers", f)),
    onSuccess: () => { refresh(); toast({ title: "Saved", description: "It's live on your crew page." }); onClose(); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{offer.id ? "Edit discount" : "Add a discount"}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="Where it applies">
            <select className={inputCls} value={f.placeId ?? ""} onChange={(e) => setF({ ...f, placeId: e.target.value ? Number(e.target.value) : null })} data-testid="select-offer-place">
              <option value="">General / at our FBO</option>
              {places.map((p) => <option key={p.id} value={p.id}>{p.name} ({FBO_CAT_LABEL[p.category]})</option>)}
            </select>
          </Field>
          <Field label="Offer"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} placeholder="15% off for crews" required data-testid="input-offer-title" autoFocus /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code (optional)"><input className={cn(inputCls, "font-code uppercase")} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={40} placeholder="CREW15" data-testid="input-offer-code" /></Field>
            <Field label="Good through (optional)"><input type="date" className={inputCls} value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} data-testid="input-offer-expires" /></Field>
          </div>
          <Field label="Details (optional)"><textarea className={areaCls} rows={2} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} maxLength={400} placeholder="Show crew ID. Dine-in only." data-testid="input-offer-details" /></Field>
          <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={!f.title || save.isPending} data-testid="button-save-offer">{save.isPending ? <Spinner /> : "Save"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
