import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fboArrival } from "@/lib/referral";

/**
 * A crew who scanned an FBO's QR code and isn't signed in: invite them to make a free account and add the spots
 * the FBO's list is missing. Shown once per FBO per browser session.
 */
export function FboWelcome() {
  const { me, loading, openAuth } = useAuth();
  const [arr] = useState(fboArrival);
  const key = arr ? `wheelsdown-fbo-welcome-${arr.slug}` : "";
  const [hidden, setHidden] = useState(() => { try { return !arr || sessionStorage.getItem(key) === "1"; } catch { return !arr; } });
  const { data: f } = useQuery<{ name: string; icao: string }>({ queryKey: [`/api/fbo-public/${arr?.slug}`], enabled: !!arr && !hidden, retry: false, staleTime: 3600_000 });
  const close = () => { setHidden(true); try { sessionStorage.setItem(key, "1"); } catch { /* */ } };
  // "Create a free crew account" on the FBO page goes straight to sign-up
  useEffect(() => { if (arr?.join && !loading && !me && f) { close(); openAuth(`Welcome from ${f.name}. Create your free crew account to rate their picks and add the spots crews love at ${f.icao}.`); } }, [loading, me, f]); // eslint-disable-line
  if (hidden || loading || me || !f) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+68px)] z-40 px-3 pb-2 sm:bottom-0 sm:pb-[calc(env(safe-area-inset-bottom)+12px)] print:hidden" data-testid="sheet-fbo-welcome">
      <div className="mx-auto max-w-xl rounded-2xl border border-card-border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Welcome from {f.name}</p>
            <p className="mt-1 text-base font-semibold leading-snug">Help the next crew at {f.icao}</p>
          </div>
          <button onClick={close} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover-elevate" data-testid="button-fbo-welcome-close"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Wheelsdown is the free layover guide built by crews. Make an account to rate the places you try, save favorites, and add the spots that aren't listed yet.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => { close(); openAuth(`Welcome from ${f.name}. It takes about a minute.`); }} className="h-10 rounded-full taxi-sign text-sm font-semibold hover-elevate" data-testid="button-fbo-welcome-join">Create free account</button>
          <Link href={`/add/${f.icao}`} onClick={close} className="grid h-10 place-items-center rounded-full border border-border text-sm font-medium hover-elevate" data-testid="link-fbo-welcome-add">Add a missing spot</Link>
        </div>
      </div>
    </div>
  );
}
