import { useProfileGaps } from "@/lib/profileGaps";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Copy, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export type Notice = {
  id: number; kind: "duplicate"; createdAt: number;
  origId: number; origName: string; origIcao: string; origAddress: string | null;
  dupId: number; dupName: string; dupAddress: string | null; dupDescription: string | null; dupWebsite: string | null; dupBy: string;
};
/** Questions waiting for this member (right now: "is this a duplicate of your listing?"). */
export function useNotices() {
  const { me } = useAuth();
  return useQuery<Notice[]>({ queryKey: ["/api/me/notices"], enabled: !!me, refetchInterval: 120_000, staleTime: 30_000 });
}
/** Small dot on the Logbook tab when something needs the member's answer. */
/** Red dot on the Logbook tab: a question waiting for you, or profile items still to fill in. */
export function NoticeDot() {
  const { data } = useNotices();
  const { todo } = useProfileGaps();
  const n = data?.length || 0;
  if (!n && !todo.length) return null;
  const label = n ? `${n} waiting for you` : `Profile: ${todo.length} item${todo.length === 1 ? "" : "s"} to finish`;
  return <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" role="status" aria-label={label} title={label} data-testid={n ? "dot-notices" : "dot-profile"} />;
}

const opt = "flex-1 min-w-[120px] h-10 rounded-full px-3 text-sm font-semibold hover-elevate disabled:opacity-50";
export function NoticeCards() {
  const { data } = useNotices();
  const { toast } = useToast();
  const answer = useMutation({
    mutationFn: async (a: { id: number; decision: "same" | "different" | "unsure" }) => (await apiRequest("POST", `/api/notices/${a.id}`, { decision: a.decision })).json(),
    onSuccess: (_r, a) => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/notices"] }); queryClient.invalidateQueries({ queryKey: ["/api/spots"] });
      toast({ title: a.decision === "same" ? "Thanks. The copy is coming down." : a.decision === "different" ? "Thanks. Both listings stay up." : "Thanks. A moderator will decide." });
    },
    onError: (e: Error) => toast({ title: "Didn't go through", description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1"), variant: "destructive" }),
  });
  if (!data?.length) return null;
  return (
    <section className="space-y-3" data-testid="section-notices">
      {data.map((n) => (
        <article key={n.id} className="rounded-2xl border-2 border-primary/60 bg-card p-4 space-y-3" data-testid={`notice-${n.id}`}>
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15"><Copy className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Is this the same place as your listing?</p>
              <p className="text-xs text-muted-foreground">Someone added a listing at {n.origIcao} that looks like yours. You know the place, so it's your call.</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-muted/50 p-3 text-xs">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Yours</p>
              <Link href={`/spot/${n.origId}`} className="text-sm font-semibold hover:underline">{n.origName}</Link>
              {n.origAddress && <p className="text-muted-foreground">{n.origAddress}</p>}
            </div>
            <div className="rounded-xl bg-muted/50 p-3 text-xs">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">New, not public yet · by {n.dupBy}</p>
              <p className="text-sm font-semibold">{n.dupName}</p>
              {n.dupAddress && <p className="text-muted-foreground">{n.dupAddress}</p>}
              {n.dupDescription && <p className="mt-1 line-clamp-3">{n.dupDescription}</p>}
              {n.dupWebsite && <a href={n.dupWebsite} target="_blank" rel="noreferrer" className="mt-1 block truncate text-primary">{n.dupWebsite}</a>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={`${opt} taxi-sign`} disabled={answer.isPending} onClick={() => answer.mutate({ id: n.id, decision: "same" })} data-testid={`button-notice-same-${n.id}`}>Same place</button>
            <button className={`${opt} border border-border`} disabled={answer.isPending} onClick={() => answer.mutate({ id: n.id, decision: "different" })} data-testid={`button-notice-different-${n.id}`}>Different places</button>
            <button className={`${opt} text-muted-foreground`} disabled={answer.isPending} onClick={() => answer.mutate({ id: n.id, decision: "unsure" })} data-testid={`button-notice-unsure-${n.id}`}>{answer.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Not sure"}</button>
          </div>
          <p className="text-[11px] text-muted-foreground">Same place: the new copy comes down and any ratings on it move to your listing. Different places: both stay up. Not sure: a moderator decides.</p>
        </article>
      ))}
    </section>
  );
}
