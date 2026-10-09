import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Bell, Check, Loader2, UserPlus } from "lucide-react";
import type { PublicUser } from "@shared/tiers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth, TierChip } from "@/lib/auth";
import { CrewAvatar } from "@/lib/aircraft";
import { NoticeCards, useFollowNotes, useUnreadCount, type FollowNote } from "@/lib/notices";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Logbook | Notifications switch shown at the top of both pages. */
export function LogbookTabs() {
  const [loc, navigate] = useLocation();
  const n = useUnreadCount();
  const tabs = [["/me", "Logbook"], ["/notifications", "Notifications"]] as const;
  return (
    <div className="grid grid-cols-2 rounded-2xl bg-muted p-1" role="tablist" aria-label="Logbook sections">
      {tabs.map(([href, label]) => {
        const on = loc === href;
        return (
          <button key={href} role="tab" aria-selected={on} onClick={() => navigate(href)} data-testid={`tab-logbook-${label.toLowerCase()}`}
            className={cn("relative inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {label}
            {href === "/notifications" && n > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white tabular" data-testid="badge-notifications">{n > 99 ? "99+" : n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const when = (t: number) => {
  if (!t) return "";
  const m = (Date.now() - t) / 60_000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  const d = m / 1440;
  return d < 2 ? "yesterday" : d < 7 ? `${Math.floor(d)} days ago` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function FollowRow({ it, fresh }: { it: FollowNote; fresh: boolean }) {
  const { toast } = useToast();
  const back = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/crew/${it.user.id}/follow`)).json(),
    onSuccess: () => {
      for (const k of ["/api/me/notifications", "/api/me/following", "/api/me/feed", "/api/me", `/api/crew/${it.user.id}`]) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: `You're following ${it.user.displayName}`, description: "Their new spots and ratings will show on your Following feed." });
    },
    onError: (e: Error) => toast({ title: "Didn't go through", description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1"), variant: "destructive" }),
  });
  const sub = [it.user.crewRole, it.user.homeBase].filter(Boolean).join(" · ");
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", fresh && "bg-primary/5")} data-testid={`notification-follow-${it.user.id}`}>
      <Link href={`/crew/${it.user.id}`} className="relative shrink-0" aria-label={`${it.user.displayName}'s profile`}>
        <CrewAvatar aircraft={it.user.aircraft} className="h-11 w-11" />
        {fresh && <span className="absolute -left-0.5 top-0 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-card" aria-label="New" />}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <Link href={`/crew/${it.user.id}`} className="font-semibold hover:underline">{it.user.displayName}</Link>
          <span className="text-muted-foreground"> started following you</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <TierChip tierId={it.user.tierId as PublicUser["tierId"]} points={it.user.points} />
          {sub && <span className="truncate">{sub}</span>}
          <span>{when(it.at)}</span>
        </div>
      </div>
      {it.followingBack ? (
        <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground" data-testid={`status-following-${it.user.id}`}>
          <Check className="h-3.5 w-3.5" />Following
        </span>
      ) : (
        <button type="button" onClick={() => back.mutate()} disabled={back.isPending} data-testid={`button-follow-back-${it.user.id}`}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full taxi-sign px-3.5 text-xs font-semibold hover-elevate disabled:opacity-60">
          {back.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}Follow back
        </button>
      )}
    </li>
  );
}

/** Logbook → Notifications: new followers (with Follow back) and listing questions waiting for you. */
export default function NotificationsPage() {
  const { me, loading, openAuth } = useAuth();
  const notes = useFollowNotes();
  // remember what was new when the page opened, so the highlight stays while you read
  const [fresh, setFresh] = useState<Set<number> | null>(null);
  const marked = useRef(false);
  useEffect(() => {
    if (!notes.data || fresh) return;
    setFresh(new Set(notes.data.items.filter((i) => i.unread).map((i) => i.user.id)));
    if (notes.data.unread > 0 && !marked.current) {
      marked.current = true;
      apiRequest("POST", "/api/me/notifications/seen").then(() => queryClient.invalidateQueries({ queryKey: ["/api/me/notifications"] })).catch(() => {});
    }
  }, [notes.data, fresh]);

  if (loading) return <Skeleton className="h-48 rounded-3xl" />;
  if (!me) return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-card-border bg-card p-6 text-center space-y-3">
        <Bell className="mx-auto h-6 w-6 text-primary" />
        <p className="font-semibold">Your notifications</p>
        <p className="text-sm text-muted-foreground">Sign in to see who followed you and follow them back.</p>
        <button onClick={() => openAuth()} className="h-11 px-6 rounded-full taxi-sign font-semibold hover-elevate" data-testid="button-notifications-signin">Sign in</button>
      </div>
    </div>
  );

  const items = notes.data?.items || [];
  const toFollow = items.filter((i) => !i.followingBack).length;
  return (
    <div className="space-y-5">
      <LogbookTabs />
      <NoticeCards />
      <section className="rounded-2xl border border-card-border bg-card" data-testid="section-follow-notifications">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2">
          <h1 className="text-sm font-semibold">Followers</h1>
          {items.length > 0 && <Link href="/followers" className="text-xs text-muted-foreground hover:text-foreground" data-testid="link-all-followers">All followers</Link>}
        </div>
        {notes.isLoading ? (
          <div className="space-y-2 p-4 pt-1"><Skeleton className="h-12 rounded-xl" /><Skeleton className="h-12 rounded-xl" /></div>
        ) : !items.length ? (
          <div className="px-4 pb-5 pt-1 text-sm text-muted-foreground" data-testid="text-notifications-empty">
            {me.anonymous ? "You post anonymously, so nobody can follow you. Turn that off in your profile settings to get followers."
              : <>Nobody has followed you yet. Adding spots and leaving detailed ratings is the best way to get noticed. You can also <Link href="/crew" className="text-primary underline">find crews to follow</Link>.</>}
          </div>
        ) : (
          <>
            {toFollow > 1 && <p className="px-4 pb-2 text-xs text-muted-foreground">{toFollow} people you don't follow back yet.</p>}
            <ul className="divide-y divide-border border-t border-border">
              {items.map((it) => <FollowRow key={it.user.id} it={it} fresh={!!fresh?.has(it.user.id)} />)}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
