import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FBO_INTEL_FIELDS, FBO_LIMITS, type FboIntel } from "@shared/fbo";
import { api, get, fboQuery } from "./api";
import { useMe } from "./App";
import { Card, PageHeader, Spinner, areaCls, btnPrimary, fmtDate } from "./ui";

export function IntelPage() {
  const { me } = useMe();
  const { data, isLoading } = useQuery<FboIntel>({ queryKey: ["/api/fbo/intel"], queryFn: get("/api/fbo/intel") });
  const [f, setF] = useState<Record<string, string>>({});
  const { toast } = useToast();
  useEffect(() => { if (data) setF(Object.fromEntries(FBO_INTEL_FIELDS.map((x) => [x.key, data[x.key]?.value || ""]))); }, [data]);
  const dirty = useMemo(() => !!data && FBO_INTEL_FIELDS.some((x) => (f[x.key] || "") !== (data[x.key]?.value || "")), [f, data]);
  const save = useMutation({
    mutationFn: () => api<{ changed: string[] }>("PUT", "/api/fbo/intel", f),
    onSuccess: (r) => { fboQuery.invalidateQueries({ queryKey: ["/api/fbo/intel"] }); fboQuery.invalidateQueries({ queryKey: ["/api/fbo/stats"] }); toast({ title: r.changed.length ? "Saved" : "No changes", description: r.changed.length ? "Live on your crew page." : undefined }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const groups = Array.from(new Set(FBO_INTEL_FIELDS.map((x) => x.group)));
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="FBO intel" sub={<>What crews want to know about your FBO. It shows on your page labeled <b>Provided by {me.account.name}</b>, with the date each item was last updated. Leave anything blank to hide it.</>}
        actions={<button className={btnPrimary} disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="button-save-intel">{save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}Save changes</button>} />
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g}>
            <p className="mb-3 text-sm font-semibold">{g}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {FBO_INTEL_FIELDS.filter((x) => x.group === g).map((x) => (
                <label key={x.key} className="block space-y-1">
                  <span className="flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground"><span>{x.label}</span>{data?.[x.key]?.updatedAt ? <span className="text-[11px] font-normal">Updated {fmtDate(data[x.key].updatedAt)}{data[x.key].updatedBy ? ` by ${data[x.key].updatedBy}` : ""}</span> : null}</span>
                  <textarea className={areaCls} rows={2} value={f[x.key] || ""} maxLength={FBO_LIMITS.intel} placeholder={x.hint} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} data-testid={`input-intel-${x.key}`} />
                </label>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Crews can still post their own FBO intel in the crew app. Yours is shown separately, so crews know where each piece came from. Keep gate and door codes off this page, since anyone with the link can see it.</p>
      {dirty && <div className="sticky bottom-4 mt-4 flex justify-end"><button className={btnPrimary + " shadow-lg"} disabled={save.isPending} onClick={() => save.mutate()}>Save changes</button></div>}
    </>
  );
}
