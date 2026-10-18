// My Crew: hooks and small pieces shared by the My Crew page, Notifications, crew profiles and Crew Up.
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, MessageSquareText, Share2, UserCheck, UserPlus, X } from "lucide-react";
import type { CrewRelation, MemberMessage, MyCrewResp, CrewRequest } from "@shared/mycrew";
import type { PublicUser } from "@shared/tiers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth, TierChip } from "@/lib/auth";
import { usePreview } from "@/lib/experience";
import { CrewAvatar } from "@/lib/aircraft";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/preview";
import { cn } from "@/lib/utils";

const KEYS = ["/api/mycrew", "/api/mycrew/find", "/api/mycrew/status", "/api/preview/meetups", "/api/preview/today", "/api/me/messages"];
export const refreshCrew = () => { for (const k of KEYS) queryClient.invalidateQueries({ queryKey: [k] }); };

export function useMyCrew() {
  const on = usePreview();
  return useQuery<MyCrewResp>({ queryKey: ["/api/mycrew"], enabled: on, staleTime: 20_000, refetchInterval: 120_000, retry: false });
}
export function useMessages() {
  const { me } = useAuth();
  return useQuery<{ unread: number; items: MemberMessage[] }>({ queryKey: ["/api/me/messages"], enabled: !!me, staleTime: 30_000, refetchInterval: 120_000, retry: false });
}

/** Send, cancel, accept or remove, depending on where the two of you stand. */
export function useCrewAction() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (a: { kind: "request" | "cancel" | "remove" | "accept" | "decline"; userId: number; requestId?: number | null; name?: string }) => {
      if (a.kind === "request") return (await apiRequest("POST", "/api/mycrew/requests", { userId: a.userId })).json();
      if (a.kind === "accept" || a.kind === "decline") return (await apiRequest("POST", `/api/mycrew/requests/${a.requestId}/${a.kind}`)).json();
      return (await apiRequest("DELETE", `/api/mycrew/${a.userId}`)).json();
    },
    onSuccess: (r: { relation?: CrewRelation }, a) => {
      refreshCrew();
      const who = a.name || "them";
      const t = a.kind === "request" ? (r?.relation === "crew" ? `${who} is in your crew` : `Crew request sent to ${who}`)
        : a.kind === "accept" ? `${who} is in your crew` : a.kind === "decline" ? "Request declined" : a.kind === "cancel" ? "Request canceled" : `${who} is out of your crew`;
      toast({ title: t, description: a.kind === "request" && r?.relation !== "crew" ? "They'll see it in Notifications. Nothing is shared until they accept." : undefined });
    },
    onError: (e: Error) => toast({ title: "Didn't go through", description: errMsg(e), variant: "destructive" }),
  });
}

const pill = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold hover-elevate disabled:opacity-60";

/** The button on a crew profile. Shown only when My Crew is available to the viewer. */
export function CrewButton({ userId, name }: { userId: number; name: string }) {
  const { me } = useAuth();
  const on = usePreview();
  const st = useQuery<{ relation: CrewRelation; requestId: number | null; allowsRequests: boolean }>({ queryKey: ["/api/mycrew/status", userId], enabled: on && !!me && me.id !== userId,
    queryFn: async () => (await apiRequest("GET", `/api/mycrew/status/${userId}`)).json(), staleTime: 20_000, retry: false });
  const act = useCrewAction();
  const [sure, setSure] = useState(false);
  if (!on || !me || me.id === userId || !st.data) return null;
  const { relation, requestId, allowsRequests } = st.data;
  const busy = act.isPending;
  if (relation === "crew") return sure
    ? <span className="inline-flex items-center gap-2"><button type="button" className={cn(pill, "border border-destructive/60 text-destructive")} disabled={busy} onClick={() => act.mutate({ kind: "remove", userId, name }, { onSettled: () => setSure(false) })} data-testid="button-crew-remove-confirm">Remove from My Crew?</button>
        <button type="button" className="text-xs text-muted-foreground" onClick={() => setSure(false)}>Keep</button></span>
    : <button type="button" className={cn(pill, "border border-border")} onClick={() => setSure(true)} data-testid="button-crew-in"><UserCheck className="h-3.5 w-3.5 text-primary" />In My Crew</button>;
  if (relation === "outgoing") return <button type="button" className={cn(pill, "border border-border text-muted-foreground")} disabled={busy} onClick={() => act.mutate({ kind: "cancel", userId, name })} data-testid="button-crew-cancel">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}Request sent · Cancel</button>;
  if (relation === "incoming") return <button type="button" className={cn(pill, "taxi-sign")} disabled={busy} onClick={() => act.mutate({ kind: "accept", userId, requestId, name })} data-testid="button-crew-accept">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Accept crew request</button>;
  if (!allowsRequests) return <span className="text-xs text-muted-foreground" data-testid="text-crew-closed">Not taking crew requests</span>;
  return <button type="button" className={cn(pill, "taxi-sign")} disabled={busy} onClick={() => act.mutate({ kind: "request", userId, name })} data-testid="button-crew-add">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}Add to My Crew</button>;
}

export function PersonLine({ p, sub }: { p: { id: number; displayName: string; aircraft: string; tierId: string; points: number; crewRole: string; homeBase: string }; sub?: string }) {
  const line = sub ?? [p.crewRole, p.homeBase].filter(Boolean).join(" · ");
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Link href={`/crew/${p.id}`} className="shrink-0" aria-label={`${p.displayName}'s profile`}><CrewAvatar aircraft={p.aircraft} className="h-10 w-10" /></Link>
      <span className="min-w-0">
        <Link href={`/crew/${p.id}`} className="block truncate text-sm font-semibold hover:underline">{p.displayName}</Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><TierChip tierId={p.tierId as PublicUser["tierId"]} points={p.points} />{line && <span className="truncate">{line}</span>}</span>
      </span>
    </span>
  );
}

/** Incoming crew requests, with Accept / Decline. Used on Notifications and My Crew. */
export function CrewRequestList({ items, title = "Crew requests" }: { items: CrewRequest[]; title?: string }) {
  const act = useCrewAction();
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border-2 border-primary/60 bg-card" data-testid="section-crew-requests">
      <h2 className="px-4 pt-4 pb-1 text-sm font-semibold">{title} <span className="ml-1 rounded-full bg-red-500 px-1.5 font-code text-[11px] font-bold text-white">{items.length}</span></h2>
      <p className="px-4 pb-2 text-xs text-muted-foreground">Accept and you'll see each other's Crew Up plans and whatever each of you shares. Declining is quiet: they aren't told.</p>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`crew-request-${r.id}`}>
            <PersonLine p={r.person} />
            <span className="flex gap-2">
              <button type="button" className={cn(pill, "taxi-sign")} disabled={act.isPending} onClick={() => act.mutate({ kind: "accept", userId: r.person.id, requestId: r.id, name: r.person.displayName })} data-testid={`button-accept-${r.id}`}><Check className="h-3.5 w-3.5" />Accept</button>
              <button type="button" className={cn(pill, "border border-border")} disabled={act.isPending} onClick={() => act.mutate({ kind: "decline", userId: r.person.id, requestId: r.id, name: r.person.displayName })} data-testid={`button-decline-${r.id}`}>Decline</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Messages from the Wheelsdown team and the app (feedback replies, "accepted your crew request"). */
export function MessageList({ items, fresh }: { items: MemberMessage[]; fresh: Set<number> | null }) {
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-card-border bg-card" data-testid="section-messages">
      <h2 className="px-4 pt-4 pb-2 text-sm font-semibold">Messages</h2>
      <ul className="divide-y divide-border border-t border-border">
        {items.slice(0, 20).map((m) => {
          const body = (
            <span className="flex items-start gap-3">
              <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15">
                {m.kind === "crew_accepted" ? <UserCheck className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
                {fresh?.has(m.id) && <span className="absolute -left-0.5 top-0 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-card" aria-label="New" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug">{m.title}</span>
                {m.body && <span className="mt-0.5 block whitespace-pre-line text-sm text-muted-foreground">{m.body}</span>}
                <span className="mt-1 block text-[11px] text-muted-foreground">{m.kind === "feedback_reply" ? "Wheelsdown team · " : ""}{new Date(m.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </span>
            </span>
          );
          return (
            <li key={m.id} className={cn("px-4 py-3", fresh?.has(m.id) && "bg-primary/5")} data-testid={`message-${m.id}`}>
              {m.link ? <Link href={m.link} className="block hover-elevate rounded-xl">{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Share your crew invite link. Used on My Crew and Crew Up. */
export function InviteCrewCard({ compact }: { compact?: boolean }) {
  const { data } = useMyCrew();
  const { me } = useAuth();
  const { toast } = useToast();
  const url = data?.inviteUrl || "";
  const text = `Join my crew on Wheelsdown, the crew-rated layover guide. Sign up with this link and we'll be connected:`;
  const share = async () => {
    if (!url) return;
    try {
      if (navigator.share) { await navigator.share({ title: "Join my crew on Wheelsdown", text, url }); return; }
    } catch { return; /* closed the share sheet */ }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast({ title: "Invite link copied", description: "Paste it in a text or your crew chat." }); }
    catch { toast({ title: "Copy this link", description: url }); }
  };
  if (!me) return null;
  return (
    <section className={cn("rounded-2xl border border-card-border bg-card p-4", compact && "p-3.5")} data-testid="card-invite-crew">
      <p className="text-sm font-semibold">Invite other crew</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Send your link to the people you fly with. When they sign up, your crew request is waiting for them to accept. Members can also find you by your handle, @{me.handle}.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={share} disabled={!url} className={cn(pill, "taxi-sign h-10")} data-testid="button-invite-crew">{typeof navigator !== "undefined" && "share" in navigator ? <Share2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}Send invite link</button>
        <Link href="/mycrew?tab=find" className={cn(pill, "border border-border h-10")} data-testid="link-find-crew"><UserPlus className="h-4 w-4" />Find crew on Wheelsdown</Link>
      </div>
    </section>
  );
}

