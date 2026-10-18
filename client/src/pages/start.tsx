// Landing page: pick an experience, then the nav is tailored to it. No navigation bar here.
// Signed-in members see it once the launch switch is on (admins always); guests are sent to Search.
import { useEffect } from "react";
import { useLocation } from "wouter";
import { BookUser, ClipboardList, Contact, MessagesSquare, PlusCircle, Search, Star, Trophy, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { setExperience, useAdminOnly, useExperience, usePreviewState, type Experience } from "@/lib/experience";
import { Logo, ThemeToggle } from "@/lib/ui";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";

type Tile = { key: string; title: string; body: string; icon: typeof Search; href: string; exp: Experience | null | "keep"; tag?: string };
// 2 columns: Find spots and Add a spot on top, Logbook full width at the bottom.
// Each tile opens its page and sets the tailored nav that page lives in.
const TILES: Tile[] = [
  { key: "spots", title: "Find spots", body: "Crew-rated food, things to do, hotels", icon: Search, href: "/", exp: "spots" },
  { key: "add", title: "Add a spot", body: "Share a place crews should know", icon: PlusCircle, href: "/add", exp: "spots" },
  { key: "plan", title: "Plan layover", body: "Today at the field and your briefings", icon: ClipboardList, href: "/today", exp: "plan" },
  { key: "rate", title: "Rate a spot", body: "Places waiting for your rating", icon: Star, href: "/rate", exp: "spots", tag: "New" },
  { key: "lounge", title: "Crew lounge", body: "Talk shop with other crews", icon: MessagesSquare, href: "/lounge", exp: "lounge", tag: "New" },
  { key: "meetup", title: "Crew Up", body: "Make layover plans with your crew", icon: Users, href: "/meetup", exp: "lounge", tag: "New" },
  { key: "mycrew", title: "My Crew", body: "Your crew friends and what you share", icon: Contact, href: "/mycrew", exp: "lounge", tag: "New" },
  { key: "leaderboard", title: "Leaderboard", body: "Points and status ranks", icon: Trophy, href: "/crew", exp: "lounge" },
  { key: "logbook", title: "Logbook", body: "Your profile, points and settings", icon: BookUser, href: "/me", exp: "keep" },
];

export default function StartPage() {
  const { me, loading } = useAuth();
  const { on: preview, ready } = usePreviewState();
  const adminOnly = useAdminOnly();
  const current = useExperience();
  const [, navigate] = useLocation();
  useEffect(() => { if (ready && !preview) navigate("/", { replace: true }); }, [ready, preview]); // eslint-disable-line
  if (!preview) return null;
  const first = (me?.displayName || "").split(" ")[0];
  const open = (t: Tile) => { setExperience(t.exp === "keep" ? current || "plan" : t.exp); navigate(t.href); };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[max(env(safe-area-inset-top),1.25rem)]" data-testid="page-start">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">Wheels<span className="text-primary">down</span></span>
        </span>
        <ThemeToggle />
      </div>

      <header className="mt-6">
        <p className="font-code text-xs font-semibold uppercase tracking-[0.2em] text-primary">Wheels down{first ? `, ${first}` : ""}</p>
        <h1 className="mt-1.5 text-[1.7rem] font-semibold leading-tight tracking-tight">What are we doing today?</h1>
        <p className="mt-2 text-sm text-muted-foreground">Pick one. You can switch any time.</p>
      </header>

      <ul className="mt-5 grid grid-cols-2 gap-2.5" data-testid="grid-start">
        {TILES.map((t) => {
          const last = t.exp !== "keep" && t.exp !== null && current === t.exp && (t.key === "plan" || t.key === "spots" || t.key === "lounge");
          return (
            <li key={t.key} className={cn(t.key === "logbook" && "col-span-2")}>
              <button type="button" onClick={() => open(t)} data-testid={`tile-start-${t.key}`}
                className={cn("group relative flex w-full flex-col justify-between gap-3 rounded-2xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  t.key === "logbook" ? "min-h-0 flex-row items-center justify-start" : "min-h-[8.75rem]",
                  "bg-card hover:border-primary/60",
                  last ? "border-primary ring-1 ring-primary/40" : "border-card-border")}>
                <span className="flex items-start justify-between gap-2">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15"><t.icon className="h-[22px] w-[22px]" /></span>
                  {last ? <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">Last used</span>
                    : t.tag && <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{t.tag}</span>}
                </span>
                <span className="block">
                  <span className="block text-[15px] font-semibold leading-tight">{t.title}</span>
                  <span className="mt-1 block text-xs leading-snug text-muted-foreground">{t.body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto pt-6 text-center text-xs text-muted-foreground">
        {adminOnly && <p className="mt-3 rounded-full border border-dashed border-border px-3 py-1.5" data-testid="text-start-preview">Preview for admins. Members still see the classic app.</p>}
        <p className="mt-3">
          Version {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
