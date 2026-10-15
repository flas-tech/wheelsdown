// Landing page (admin preview): pick an experience, then the nav is tailored to it. No navigation bar here.
// Members never see it; they're sent to Search, exactly as today.
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ClipboardList, MessagesSquare, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { EXPERIENCE_HOME, setExperience, useExperience, usePreview, type Experience } from "@/lib/experience";
import { Logo, ThemeToggle } from "@/lib/ui";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";

const CHOICES: { id: Experience; title: string; body: string; icon: typeof Search; tag?: string }[] = [
  { id: "plan", title: "Plan a layover", body: "Build a briefing for your trip with food, things to do and hotels at every stop, then share it with your crew.", icon: ClipboardList },
  { id: "spots", title: "Find spots", body: "Search crew-rated places to eat, things to do and places to stay, by airport or along your route.", icon: Search },
  { id: "lounge", title: "Crew Lounge", body: "Talk shop with other crews about airport ops, gear, layover life and the app.", icon: MessagesSquare, tag: "Admins only" },
];

export default function StartPage() {
  const { me, loading } = useAuth();
  const preview = usePreview();
  const current = useExperience();
  const [, navigate] = useLocation();
  useEffect(() => { if (!loading && !preview) navigate("/", { replace: true }); }, [loading, preview]); // eslint-disable-line
  if (!preview) return null;
  const first = (me?.displayName || "").split(" ")[0];
  const choose = (e: Experience) => { setExperience(e); navigate(EXPERIENCE_HOME[e]); };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-[max(env(safe-area-inset-top),1.25rem)]" data-testid="page-start">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">Wheels<span className="text-primary">down</span></span>
        </span>
        <ThemeToggle />
      </div>

      <header className="mt-10">
        <p className="font-code text-xs font-semibold uppercase tracking-[0.2em] text-primary">Wheels down{first ? `, ${first}` : ""}</p>
        <h1 className="mt-2 text-[1.9rem] font-semibold leading-tight tracking-tight">What are we doing today?</h1>
        <p className="mt-2 text-sm text-muted-foreground">Pick one. You can switch any time.</p>
      </header>

      <ul className="mt-7 space-y-3" data-testid="list-experiences">
        {CHOICES.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => choose(c.id)} data-testid={`button-experience-${c.id}`}
              className={cn("group flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                current === c.id ? "border-primary ring-1 ring-primary/40" : "border-card-border")}>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/15 text-foreground"><c.icon className="h-6 w-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{c.title}</span>
                  {c.tag && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{c.tag}</span>}
                  {current === c.id && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">Last used</span>}
                </span>
                <span className="mt-1 block text-sm leading-snug text-muted-foreground">{c.body}</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-10 text-center text-xs text-muted-foreground">
        <p className="rounded-full border border-dashed border-border px-3 py-1.5" data-testid="text-start-preview">Preview for admins. Members still see the classic app.</p>
        <p className="mt-3">
          <Link href="/" onClick={() => setExperience(null)} className="font-semibold text-foreground underline underline-offset-2" data-testid="link-start-classic">Back to the classic app</Link>
          <span className="mx-2">·</span>Version {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
