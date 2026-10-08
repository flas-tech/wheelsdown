import { Check, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";

type Me = { bio?: string | null; aircraft?: string | null; interests?: string[] | null; homeBase?: string | null; email?: string | null; anonymous?: boolean };
const ITEMS: { key: string; label: string; target: string; done: (m: Me) => boolean; publicOnly?: boolean }[] = [
  { key: "aircraft", label: "Pick the aircraft you fly", target: "pf-aircraft", done: (m) => !!m.aircraft },
  { key: "bio", label: "Write a line about you", target: "pf-bio", done: (m) => !!m.bio?.trim(), publicOnly: true },
  { key: "interests", label: "Choose your expertise badges", target: "pf-interests", done: (m) => !!m.interests?.length, publicOnly: true },
  { key: "base", label: "Add your home base", target: "pf-base", done: (m) => !!m.homeBase },
  { key: "email", label: "Add an email for password reset", target: "pf-email", done: (m) => !!m.email },
];

/** Profile items still to fill in. Bio and badges are skipped while posting anonymously, since they're hidden then. */
export function profileGaps(me: Me | null | undefined) {
  if (!me) return { todo: [], total: 0 };
  const items = ITEMS.filter((i) => !(i.publicOnly && me.anonymous));
  return { todo: items.filter((i) => !i.done(me)), total: items.length };
}

export function useProfileGaps() {
  const { me } = useAuth();
  return profileGaps(me as Me | null);
}

/** Checklist on the Logbook; each item jumps to its field in the profile settings below. */
export function ProfileChecklist() {
  const { todo, total } = useProfileGaps();
  if (!todo.length) return null;
  const done = total - todo.length;
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const f = el.querySelector<HTMLElement>("input, textarea, button");
    setTimeout(() => f?.focus({ preventScroll: true }), 400);
  };
  return (
    <section className="rounded-2xl border border-primary/50 bg-primary/5 p-4" data-testid="card-profile-checklist">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Finish your profile</p>
        <p className="text-xs text-muted-foreground tabular" data-testid="text-profile-progress">{done} of {total} done</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-primary" style={{ width: `${(done / total) * 100}%` }} /></div>
      <p className="mt-2 text-xs text-muted-foreground">Crews trust picks from people they can see. It takes about a minute.</p>
      <ul className="mt-2 divide-y divide-border/60">
        {todo.map((i) => (
          <li key={i.key}>
            <button type="button" onClick={() => go(i.target)} className="flex w-full items-center gap-2.5 py-2.5 text-left text-sm hover:text-primary" data-testid={`button-gap-${i.key}`}>
              <span className="h-4 w-4 shrink-0 rounded border-2 border-muted-foreground/60" aria-hidden />
              <span className="flex-1">{i.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Check className="h-3 w-3" />The dot on Logbook clears when everything's filled in and saved.</p>
    </section>
  );
}
