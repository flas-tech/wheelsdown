// One-tap directions to a place, in Apple Maps or Google Maps (crew feedback, Oct 18 2026).
// Both links are universal https links: on a phone they open the installed Maps / Google Maps app.
import { Navigation } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trackOut } from "@/lib/metrics";
import { noteVisit } from "@/lib/visits";
import { cn } from "@/lib/utils";

export type Place = { id: number; name: string; icao?: string; address?: string | null; lat?: number | null; lng?: number | null };

const hasLL = (p: Place) => p.lat != null && p.lng != null && !(p.lat === 0 && p.lng === 0);
const query = (p: Place) => [p.name, p.address].filter(Boolean).join(" ");

export function appleMapsUrl(p: Place) {
  const q = encodeURIComponent(query(p));
  return hasLL(p) ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}&q=${q}&dirflg=d` : `https://maps.apple.com/?daddr=${q}&dirflg=d`;
}
export function googleMapsUrl(p: Place) {
  // a name + address search lands on the business listing; coordinates are the fallback when there's no address
  const dest = p.address ? encodeURIComponent(query(p)) : hasLL(p) ? `${p.lat},${p.lng}` : encodeURIComponent(query(p));
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}
export const canNavigate = (p: Place) => !!p.address || hasLL(p);

/** "Directions" button that offers Apple Maps or Google Maps. `size="lg"` for the place page, "sm" for list rows, "icon" for tight rows. */
export function DirectionsButton({ place, size = "sm", visitHref, className, testId }: { place: Place; size?: "sm" | "lg" | "icon"; visitHref?: string; className?: string; testId?: string }) {
  if (!canNavigate(place)) return null;
  const tid = testId || `button-directions-${place.id}`;
  const opened = () => {
    trackOut("map");
    if (place.icao) noteVisit({ id: place.id, name: place.name, icao: place.icao, ...(visitHref ? { href: visitHref } : {}) });
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Directions to ${place.name}`} data-testid={tid}
          className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold hover-elevate",
            size === "lg" ? "h-11 w-full bg-primary px-4 text-sm text-primary-foreground"
              : size === "icon" ? "h-8 w-8 border border-border text-foreground"
              : "h-8 border border-border px-3 text-xs text-foreground", className)}>
          <Navigation className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />{size !== "icon" && "Directions"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Open directions in</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={appleMapsUrl(place)} target="_blank" rel="noopener noreferrer" onClick={opened} data-testid={`${tid}-apple`}>Apple Maps</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={googleMapsUrl(place)} target="_blank" rel="noopener noreferrer" onClick={opened} data-testid={`${tid}-google`}>Google Maps</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
