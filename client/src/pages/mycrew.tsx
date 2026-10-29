// My Crew: your crew friends (both of you agreed), requests, finding people, and what you share with them.
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Contact, Heart, Loader2, MapPin, Search, ShieldCheck, Users } from "lucide-react";
import type { CrewFindRow, CrewMember, CrewPrivacy, CrewShared } from "@shared/mycrew";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { PreviewBadge, PreviewGate, errMsg, ago } from "@/lib/preview";
import { ThreadButton } from "@/lib/dm";
import { OverlapsCard, FamilyLinkCard } from "@/lib/crewNetwork";
import { CrewButton, CrewRequestList, RemoveFromCrew, InviteCrewCard, PersonLine, useCrewAction, useMyCrew } from "@/lib/mycrew";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Tab = "crew" | "requests" | "find" | "privacy";
const TABS: [Tab, string][] = [["crew", "My Crew"], ["requests", "Requests"], ["find", "Find"], ["privacy", "Privacy"]];

export default function MyCrewPage() { return <PreviewGate><MyCrew /></PreviewGate>; }

function MyCrew() {
  const [loc] = useLocation();
  // the hash router keeps the query after the "#" (or before it, on a first load from a shared link)
  const search = window.location.hash.split("?")[1] || window.location.search.slice(1);
  const initial = (new URLSearchParams(search).get("tab") as Tab) || "crew";
  const [tab, setTab] = useState<Tab>(TABS.some(([t]) => t === initial) ? initial : "crew");
  useEffect(() => { const t = new URLSearchParams(search).get("tab") as Tab; if (t && TABS.some(([x]) => x === t)) setTab(t); }, [search, loc]);
  // a link to /mycrew?tab=… from this same page only changes the query, which doesn't re-render the route (feedback #52)
  useEffect(() => {
    const on = () => { const t = new URLSearchParams(window.location.hash.split("?")[1] || "").get("tab") as Tab; if (t && TABS.some(([x]) => x === t)) setTab(t); };
    window.addEventListener("hashchange", on); window.addEventListener("popstate", on);
    return () => { window.removeEventListener("hashchange", on); window.removeEventListener("popstate", on); };
  }, []);
  const { data, isLoading, error } = useMyCrew();
  const waiting = data?.incoming.length || 0;

  return (
    <div className="space-y-4" data-testid="page-mycrew">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Contact className="h-5 w-5 text-primary" />My Crew</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">People you fly with. Crew Up plans are only seen by your crew.</p>
        </div>
        <PreviewBadge />
      </header>

      <div className="grid grid-cols-4 rounded-2xl bg-muted p-1" role="tablist" aria-label="My Crew sections">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`tab-mycrew-${t}`}
            className={cn("relative inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition-colors", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {label}
            {t === "requests" && waiting > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white tabular">{waiting}</span>}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{errMsg(error)}</p>
        : isLoading || !data ? <div className="space-y-2"><Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-16 rounded-2xl" /></div>
        : tab === "crew" ? <><OverlapsCard /><CrewList crew={data.crew} onFind={() => { setTab("find"); window.scrollTo({ top: 0 }); }} /><FamilyLinkCard /></>
        : tab === "requests" ? <Requests />
        : tab === "find" ? <Find />
        : <Privacy p={data.privacy} />}
    </div>
  );
}

function CrewList({ crew, onFind }: { crew: CrewMember[]; onFind: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!crew.length) return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-card-border bg-card p-6 text-center" data-testid="text-mycrew-empty">
        <Users className="mx-auto h-6 w-6 text-primary" />
        <p className="mt-2 font-semibold">No crew yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Add the people you fly with. You both have to agree before anything is shared.</p>
        <button type="button" onClick={onFind} className="mt-3 h-10 rounded-full taxi-sign px-5 text-sm font-semibold hover-elevate" data-testid="button-mycrew-find">Add a member to My Crew</button>
      </div>
      <InviteCrewCard onFind={onFind} />
    </div>
  );
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-card-border bg-card" data-testid="section-crew-list">
        <p className="px-4 pt-3 pb-2 text-xs text-muted-foreground">{crew.length} in your crew · tap <ChevronRight className="inline h-3 w-3 -mt-0.5" /> to see what they share or remove them</p>
        <ul className="divide-y divide-border border-t border-border">
          {crew.map((c) => (
            <li key={c.id} data-testid={`crew-member-${c.id}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                <PersonLine p={c} />
                {c.crewUpAt && <Link href={`/meetup?icao=${c.crewUpAt}`} className="shrink-0 rounded-full bg-primary/20 px-2 py-1 font-code text-[11px] font-bold text-foreground" aria-label={`Crew Up at ${c.crewUpAt}`} data-testid={`badge-crewup-${c.id}`}>{c.crewUpAt}</Link>}
                <ThreadButton userId={c.id} label="" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border hover-elevate disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4" ariaLabel={`Message ${c.displayName}`} testId={`button-message-row-${c.id}`} />
                <button type="button" onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-expanded={openId === c.id} aria-label={`What ${c.displayName} shares`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover-elevate" data-testid={`button-crew-open-${c.id}`}>
                  {openId === c.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
              {openId === c.id && <Shared member={c} />}
            </li>
          ))}
        </ul>
      </section>
      <InviteCrewCard onFind={onFind} />
    </div>
  );
}

function Shared({ member }: { member: CrewMember }) {
  const { data, isLoading } = useQuery<CrewShared>({ queryKey: ["/api/mycrew", member.id, "shared"], queryFn: async () => (await apiRequest("GET", `/api/mycrew/${member.id}/shared`)).json(), staleTime: 60_000 });
  const first = member.displayName.split(" ")[0];
  return (
    <div className="space-y-3 border-t border-dashed border-border bg-muted/30 px-4 py-3 text-sm" data-testid={`shared-${member.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">In your crew since {new Date(member.since).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
        <span className="flex items-center gap-2"><ThreadButton userId={member.id} /><RemoveFromCrew userId={member.id} name={member.displayName} /></span>
      </div>
      {isLoading || !data ? <Skeleton className="h-12 rounded-xl" /> : (
        <>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><MapPin className="h-3.5 w-3.5" />Check-ins (last 60 days)</p>
            {data.checkins == null ? <p className="mt-1 text-xs text-muted-foreground">{first} keeps check-ins private.</p>
              : !data.checkins.length ? <p className="mt-1 text-xs text-muted-foreground">No check-ins lately.</p>
              : <ul className="mt-1 space-y-1">{data.checkins.slice(0, 12).map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm">
                    {c.spotId ? <Link href={`/spot/${c.spotId}`} className="truncate hover:underline">{c.name}</Link> : <span className="truncate">{c.name}</span>}
                    <span className="shrink-0 text-xs text-muted-foreground"><span className="font-code">{c.icao}</span> · {ago(c.at)}</span>
                  </li>))}</ul>}
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Heart className="h-3.5 w-3.5" />Favorites</p>
            {data.favorites == null ? <p className="mt-1 text-xs text-muted-foreground">{first} keeps favorites private.</p>
              : !data.favorites.length ? <p className="mt-1 text-xs text-muted-foreground">No favorites yet.</p>
              : <ul className="mt-1 flex flex-wrap gap-1.5">{data.favorites.slice(0, 24).map((f) => (
                  <li key={f.id}><Link href={`/spot/${f.id}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs hover-elevate"><span className="font-code text-[10px] text-muted-foreground">{f.icao}</span>{f.name}</Link></li>))}</ul>}
          </div>
        </>
      )}
    </div>
  );
}

function Requests() {
  const { data } = useMyCrew();
  const act = useCrewAction();
  if (!data) return null;
  return (
    <div className="space-y-4">
      {data.incoming.length ? <CrewRequestList items={data.incoming} title="Waiting for you" />
        : <p className="rounded-2xl border border-card-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-no-requests">No crew requests waiting for you.</p>}
      {data.outgoing.length > 0 && (
        <section className="rounded-2xl border border-card-border bg-card" data-testid="section-outgoing">
          <h2 className="px-4 pt-4 pb-2 text-sm font-semibold">You sent</h2>
          <ul className="divide-y divide-border border-t border-border">
            {data.outgoing.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <PersonLine p={r.person} sub={`Sent ${ago(r.at)}`} />
                <button type="button" disabled={act.isPending} onClick={() => act.mutate({ kind: "cancel", userId: r.person.id, name: r.person.displayName })} className="inline-flex h-9 shrink-0 items-center rounded-full border border-border px-3.5 text-xs font-semibold hover-elevate" data-testid={`button-cancel-${r.id}`}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Find() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, isFetching } = useQuery<CrewFindRow[]>({ queryKey: ["/api/mycrew/find", term], enabled: term.length >= 2,
    queryFn: async () => (await apiRequest("GET", `/api/mycrew/find?q=${encodeURIComponent(term)}`)).json(), staleTime: 15_000 });
  return (
    <div className="space-y-4">
      <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, @handle or home base" autoFocus className="h-full flex-1 bg-transparent text-sm outline-none" data-testid="input-find-crew" />
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </label>
      <p className="text-xs text-muted-foreground">Members who post anonymously only show up when you type their exact @handle.</p>
      {term.length >= 2 && data && (
        data.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-card-border bg-card" data-testid="list-find-crew">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`find-row-${r.id}`}>
                <PersonLine p={r} />
                <CrewButton userId={r.id} name={r.displayName} />
              </li>
            ))}
          </ul>
        ) : <p className="rounded-2xl border border-card-border bg-card p-4 text-sm text-muted-foreground" data-testid="text-find-empty">Nobody matches "{term}". If they aren't on Wheelsdown yet, text them a sign-up link below.</p>
      )}
      <InviteCrewCard inFind />
    </div>
  );
}

function Privacy({ p }: { p: CrewPrivacy }) {
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (patch: Partial<CrewPrivacy>) => (await apiRequest("PUT", "/api/mycrew/privacy", patch)).json(),
    onMutate: (patch) => { queryClient.setQueryData(["/api/mycrew"], (d: any) => d ? { ...d, privacy: { ...d.privacy, ...patch } } : d); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mycrew"] }); toast({ title: "Saved" }); },
    onError: (e: Error) => { queryClient.invalidateQueries({ queryKey: ["/api/mycrew"] }); toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }); },
  });
  const rows: { key: keyof CrewPrivacy; title: string; body: string }[] = [
    { key: "shareCheckins", title: "Share my check-ins", body: "Your crew sees the places and airports you've checked in at in the last 60 days." },
    { key: "shareFavorites", title: "Share my favorites", body: "Your crew sees the places you've saved as favorites." },
    { key: "allowRequests", title: "Accept crew requests", body: "Turn off to stop new requests. You can still send them, and your current crew stays." },
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-card-border bg-card" data-testid="section-crew-privacy">
        <h2 className="px-4 pt-4 pb-1 text-sm font-semibold">What your crew can see</h2>
        <p className="px-4 pb-2 text-xs text-muted-foreground">Only people in your crew. Nobody else sees any of this.</p>
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-4 px-4 py-3">
              <span><span className="block text-sm font-medium">{r.title}</span><span className="block text-xs text-muted-foreground">{r.body}</span></span>
              <Switch checked={p[r.key]} onCheckedChange={(v) => save.mutate({ [r.key]: v })} data-testid={`switch-${r.key}`} aria-label={r.title} />
            </li>
          ))}
        </ul>
      </section>
      <section className="flex items-start gap-3 rounded-2xl border border-card-border bg-card p-4 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p><span className="font-semibold text-foreground">Always shared with your crew:</span> your display name (even if you post anonymously), your Crew Up plans, and your profile. Crew Up plans stay at the airport level, never your hotel. Remove someone any time from their row in My Crew; they aren't told.</p>
      </section>
    </div>
  );
}
