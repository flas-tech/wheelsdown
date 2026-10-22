// Private messages: your conversations (/messages) and one conversation (/messages/:id). End-to-end encrypted:
// text is encrypted and decrypted on this device (lib/dmCrypto.ts); the server only ever has ciphertext.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, Loader2, Lock, MessageCircle, Send, ShieldCheck, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useDmDevice, useDmOn, useDmConfig } from "@/lib/dm";
import { openMessage, sealMessage, safetyCode, type Opened } from "@/lib/dmCrypto";
import { DM_RULES, type DmConversation, type DmDevice, type DmThread } from "@shared/dm";

const PRIVATE_NOTE = "End-to-end encrypted. Only the people in this conversation can read it. Wheelsdown and its admins can't.";

export function convTitle(c: DmConversation) {
  if (c.kind === "crewup" && c.meetup) {
    const when = new Date(c.meetup.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `Crew Up at ${c.meetup.icao} · ${when}`;
  }
  return c.people.map((p) => p.name).join(", ") || "Former member";
}
const ago = (t: number) => {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "now"; if (m < 60) return `${m} min`; const h = Math.round(m / 60); if (h < 24) return `${h} h`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function Gate({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const cfg = useDmConfig();
  if (!me) return <p className="text-sm text-muted-foreground">Sign in to see your messages.</p>;
  if (cfg.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (!cfg.data?.available) return <p className="text-sm text-muted-foreground" data-testid="text-dm-closed">Messages aren't open yet.</p>;
  return <>{children}</>;
}

export default function MessagesPage() {
  const [isThread, params] = useRoute("/messages/:id");
  return <Gate>{isThread ? <Thread id={Number(params!.id)} /> : <Inbox />}</Gate>;
}

function Inbox() {
  const { data, isLoading } = useQuery<{ conversations: DmConversation[] }>({ queryKey: ["/api/dm/conversations"], refetchInterval: 20_000 });
  useDmDevice(); // set this device up while you look
  const list = data?.conversations || [];
  return (
    <div className="space-y-4" data-testid="page-messages">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Messages</h1>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />{PRIVATE_NOTE}</p>
      </header>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : !list.length ? (
        <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground" data-testid="text-dm-empty">
          No messages yet. Tap Message next to someone in <Link href="/mycrew" className="font-semibold text-primary underline">My Crew</Link>, or open Messages on a <Link href="/meetup" className="font-semibold text-primary underline">Crew Up</Link> plan to talk it over with everyone on it.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/messages/${c.id}`} className="flex items-center gap-3 p-3.5 hover-elevate" data-testid={`row-conv-${c.id}`}>
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", c.kind === "crewup" ? "bg-primary/15 text-primary" : "bg-muted")}>
                  {c.kind === "crewup" ? <Users className="h-5 w-5" /> : <span className="text-sm font-semibold">{(c.people[0]?.name || "?").slice(0, 1)}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{convTitle(c)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.kind === "crewup" ? c.people.map((p) => p.name).join(", ") || "Just you so far" : c.people[0]?.crewRole || ""}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[11px] text-muted-foreground">{ago(c.lastAt)}</span>
                  {c.unread && <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-label="Unread" data-testid={`dot-conv-${c.id}`} />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thread({ id }: { id: number }) {
  const { me } = useAuth();
  const { toast } = useToast();
  const { device, ready, error } = useDmDevice();
  const key = ["/api/dm/conversations", id, device?.deviceId ?? 0];
  const { data, isLoading, isError } = useQuery<DmThread>({
    queryKey: key, enabled: !!device,
    queryFn: async () => (await apiRequest("GET", `/api/dm/conversations/${id}?device=${device!.deviceId}`)).json(),
    refetchInterval: 5000,
  });
  const [opened, setOpened] = useState<Map<number, Opened>>(new Map());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const c = data?.conversation;

  // decrypt what's new
  useEffect(() => {
    if (!data || !device) return;
    const todo = data.messages.filter((m) => !opened.has(m.id));
    if (!todo.length) return;
    let live = true;
    Promise.all(todo.map((m) => openMessage(id, device, m, data.devices))).then((res) => {
      if (!live) return;
      setOpened((prev) => { const n = new Map(prev); for (const r of res) n.set(r.id, r); return n; });
    });
    return () => { live = false; };
  }, [data, device]); // eslint-disable-line
  const lastId = data?.messages[data.messages.length - 1]?.id || 0;
  useEffect(() => {
    if (!lastId) return;
    end.current?.scrollIntoView({ block: "end" });
    void apiRequest("POST", `/api/dm/conversations/${id}/read`, {}).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/dm/unread"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dm/conversations"], exact: true });
    }).catch(() => {});
  }, [lastId]); // eslint-disable-line

  const names = useMemo(() => new Map((c?.people || []).map((p) => [p.id, p.name])), [c]);

  async function send() {
    const t = text.trim();
    if (!t || !device || !data || busy) return;
    setBusy(true);
    try {
      let devices: DmDevice[] = data.devices.filter((d) => !(d as any).retired);
      for (let attempt = 0; attempt < 2; attempt++) {
        const body = await sealMessage(id, device, devices, t);
        const r = await fetchSend(id, body);
        if (r.ok) { setText(""); queryClient.invalidateQueries({ queryKey: key }); queryClient.invalidateQueries({ queryKey: ["/api/dm/conversations"], exact: true }); return; }
        if (r.status === 409 && r.json?.devices) { devices = r.json.devices; continue; } // someone's devices changed: encrypt again
        throw new Error(r.json?.message || "That message couldn't be sent.");
      }
      throw new Error("That message couldn't be sent. Try again.");
    } catch (e: any) {
      toast({ title: "Not sent", description: String(e?.message || e), variant: "destructive" });
    } finally { setBusy(false); }
  }
  async function showCode() {
    if (!data) return;
    setCode(await safetyCode(data.devices.filter((d) => !(d as any).retired).map((d) => `${d.userId}:${d.encPub}:${d.sigPub}`)));
  }

  if (!ready) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Setting up private messages on this device…</p>;
  if (error || !device) return <p className="text-sm text-destructive" data-testid="text-dm-error">{error || "This browser can't do private messages."}</p>;
  if (isError) return <p className="text-sm text-muted-foreground">That conversation isn't available. <Link href="/messages" className="text-primary underline">All messages</Link></p>;

  return (
    <div className="flex min-h-[60dvh] flex-col gap-3" data-testid="page-thread">
      <header className="space-y-1">
        <Link href="/messages" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-thread-back"><ArrowLeft className="h-4 w-4" />Messages</Link>
        <h1 className="text-lg font-semibold leading-tight" data-testid="text-thread-title">{c ? convTitle(c) : "…"}</h1>
        {c?.kind === "crewup" && <p className="text-xs text-muted-foreground">{c.people.length ? `With ${c.people.map((p) => p.name).join(", ")}` : "Only you so far"}{c.meetup && <> · <Link href={`/meetup?icao=${c.meetup.icao}&plan=${c.meetup.id}`} className="text-primary underline">See the plan</Link></>}</p>}
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><Lock className="mt-0.5 h-3 w-3 shrink-0" />{PRIVATE_NOTE}
          <button type="button" onClick={showCode} className="ml-1 shrink-0 font-semibold text-primary underline" data-testid="button-safety-code">Safety code</button></p>
        {code && <div className="rounded-xl border border-border bg-muted/50 p-3 text-xs" data-testid="text-safety-code">
          <p className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />Compare this code in person</p>
          <p className="mt-1 whitespace-pre-line font-code text-sm tracking-wider">{code}</p>
          <p className="mt-1 text-muted-foreground">Everyone in this conversation sees the same code when nobody's keys were swapped. It changes when someone adds or resets a device.</p>
        </div>}
        {!!c?.noDevice.length && <p className="rounded-lg bg-orange-500/10 p-2 text-[11px] text-orange-700 dark:text-orange-300" data-testid="text-dm-nodevice">
          {c.noDevice.map((i) => names.get(i) || "Someone").join(", ")} {c.noDevice.length === 1 ? "hasn't" : "haven't"} opened Wheelsdown since messages started, so they'll only see messages sent after they do.</p>}
      </header>

      <div className="flex-1 space-y-2" data-testid="list-messages">
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {data && !data.messages.length && <p className="py-6 text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-1 h-6 w-6" />{c?.kind === "crewup" ? "Talk the plan over here. Everyone on the plan sees it." : "Say hello."}</p>}
        {data?.messages.map((m) => {
          const mine = m.senderId === me?.id;
          const o = opened.get(m.id);
          return (
            <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")} data-testid={`msg-${m.id}`}>
              {!mine && c?.kind === "crewup" && <span className="mb-0.5 px-1 text-[11px] font-semibold text-muted-foreground">{names.get(m.senderId) || "Crew"}</span>}
              <div className={cn("max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                o?.state === "ok" ? (mine ? "taxi-sign" : "bg-muted") : "border border-dashed border-border italic text-muted-foreground")}>
                {!o ? "…" : o.state === "ok" ? o.text : o.state === "no-key" ? "Sent before this device was set up, so it can't be read here." : "This message couldn't be checked, so it isn't shown."}
              </div>
              <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">{ago(m.createdAt)}</span>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {c && (c.canSend ? (
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex items-end gap-2 rounded-2xl border border-border bg-card p-2 sm:bottom-2">
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, DM_RULES.textMax))} rows={1} placeholder="Message"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as any).isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); void send(); } }}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none" aria-label="Message" data-testid="input-message" />
          <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-full taxi-sign disabled:opacity-40" data-testid="button-send">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      ) : <p className="rounded-xl bg-muted p-3 text-center text-xs text-muted-foreground" data-testid="text-dm-closed-thread">{c.kind === "direct" ? "You're no longer crew, so you can't send new messages here." : "This plan has ended, so the thread is closed."}</p>)}
    </div>
  );
}

async function fetchSend(id: number, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const r = await apiRequest("POST", `/api/dm/conversations/${id}/messages`, body);
    return { ok: true, status: r.status, json: await r.json() };
  } catch (e: any) {
    // apiRequest throws "409: {json}" on errors
    const m = /^(\d{3}):\s*([\s\S]*)$/.exec(String(e?.message || ""));
    let json: any = null; try { json = m ? JSON.parse(m[2]) : null; } catch { /* not json */ }
    return { ok: false, status: m ? Number(m[1]) : 0, json };
  }
}

export { useDmOn };
