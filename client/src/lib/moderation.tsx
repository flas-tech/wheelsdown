// What a poster sees while the automatic check runs on their listing, rating or edit.
import { Link } from "wouter";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModInfo = { status: string; state: string; note: string; pendingEdit?: unknown | null } | null | undefined;

export function ModNotice({ kind, state, status, note, editPending, editHref, className }: {
  kind: "listing" | "rating"; state: string; status: string; note: string; editPending?: boolean; editHref?: string; className?: string;
}) {
  const checking = state === "checking";
  const held = state === "flagged";
  if (!checking && !held && status === "live") return null;
  if (!checking && !held && status !== "pending") return null;
  const what = editPending ? `Your edit to this ${kind}` : `Your ${kind}`;
  return (
    <div role="status" data-testid={`notice-mod-${kind}`}
      className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-sm", held ? "border-orange-500/40 bg-orange-500/10" : "border-primary/30 bg-primary/10", className)}>
      {checking ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" /> : held ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
      <div className="min-w-0">
        {checking && <p><span className="font-semibold">{what} is being checked.</span> It usually takes under a minute. Only you can see it until then{editPending ? "; crews still see the current version" : ""}.</p>}
        {held && <>
          <p className="font-semibold">{what} is on hold{editPending ? "; crews still see the current version" : " and isn't public yet"}.</p>
          {note && <p className="mt-0.5 text-muted-foreground" data-testid={`text-mod-note-${kind}`}>{note}</p>}
          <p className="mt-1 text-xs text-muted-foreground">Fix it and save to check again, or a moderator will review it.{editHref && <> <Link href={editHref} className="font-medium text-primary underline underline-offset-2">Edit</Link></>}</p>
        </>}
        {!checking && !held && status === "pending" && <p>Waiting for a moderator before it goes live.</p>}
      </div>
    </div>
  );
}
