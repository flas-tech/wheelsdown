// Favorites: private to each crew member, no points. Favorites always appear in that member's trip briefings.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function useFavorites() {
  const { me } = useAuth();
  const { data } = useQuery<number[]>({ queryKey: ["/api/me/favorites/ids"], enabled: !!me });
  const ids = new Set(me ? data || [] : []);
  return { ids, has: (id: number) => ids.has(id) };
}

export function FavoriteButton({ spotId, name, size = "md", className }: { spotId: number; name?: string; size?: "sm" | "md"; className?: string }) {
  const { has } = useFavorites();
  const { requireAuth } = useAuth();
  const { toast } = useToast();
  const on = has(spotId);
  const m = useMutation({
    mutationFn: async (next: boolean) => (await apiRequest("PUT", `/api/spots/${spotId}/favorite`, { on: next })).json(),
    onMutate: async (next: boolean) => {
      const prev = queryClient.getQueryData<number[]>(["/api/me/favorites/ids"]) || [];
      queryClient.setQueryData(["/api/me/favorites/ids"], next ? [...prev.filter((x) => x !== spotId), spotId] : prev.filter((x) => x !== spotId));
      return { prev };
    },
    onError: (e: Error, _n, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/me/favorites/ids"], ctx.prev);
      toast({ title: "Couldn't update favorites", description: e.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/favorites"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/briefings"] });
    },
    onSuccess: (_r, next) => toast({ title: next ? "Saved to Favorites" : "Removed from Favorites", description: next ? `${name ? name + " will" : "It will"} always be in your trip briefings for this airport.` : undefined }),
  });
  const sm = size === "sm";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Save to favorites"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); requireAuth(() => m.mutate(!on), "Sign in to save favorites. They show up in every trip briefing you build."); }}
      data-testid={`button-favorite-${spotId}`}
      className={cn("inline-grid place-items-center rounded-full border hover-elevate shrink-0", sm ? "h-8 w-8" : "h-10 w-10",
        on ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400" : "border-border bg-card text-muted-foreground", className)}
    >
      <Heart className={sm ? "h-4 w-4" : "h-5 w-5"} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
