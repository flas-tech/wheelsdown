// What a member asks AI for when looking for more places: any, a category, a food type, a type of thing to do, or
// "local" (Surprise me: what the area is known for). The same value is stored on the AI picks it produced, so a
// briefing can say why each one is there.
import { CUISINES, cuisineLabel, cuisinesOf } from "./cuisine";
import { ACTIVITIES, activityLabel, activitiesOf } from "./activities";

export type Focus = string; // "" | "local" | "eat" | "do" | "stay" | <cuisine id> | "act:<activity id>"
export const isFocus = (f: string) =>
  f === "" || f === "local" || f === "eat" || f === "do" || f === "stay" || CUISINES.some((c) => c.id === f) || (f.startsWith("act:") && ACTIVITIES.some((a) => a.id === f.slice(4)));
/** The category a focus belongs to, or null for any / local. */
export function focusCategory(f: Focus): "eat" | "do" | "stay" | null {
  if (f === "eat" || f === "do" || f === "stay") return f;
  if (f.startsWith("act:")) return "do";
  if (CUISINES.some((c) => c.id === f)) return "eat";
  return null;
}
export function focusLabel(f: Focus): string {
  if (!f) return "Any places";
  if (f === "local") return "Local favorites";
  if (f === "eat") return "Food";
  if (f === "do") return "Things to do";
  if (f === "stay") return "Hotels";
  if (f.startsWith("act:")) return activityLabel(f.slice(4));
  return cuisineLabel(f);
}
type Item = { category: string; name: string; description?: string | null; tags?: string | null; crewTip?: string | null; ai?: { focus?: string } };
/** Does a listing or AI pick fit what was asked for? */
export function matchesFocus(s: Item, f: Focus): boolean {
  if (!f) return true;
  if (f === "local") return s.ai?.focus === "local";
  const cat = focusCategory(f);
  if (cat && s.category !== cat) return false;
  if (f === "eat" || f === "do" || f === "stay") return true;
  if (f.startsWith("act:")) return s.ai?.focus === f || activitiesOf(s).includes(f.slice(4));
  return s.ai?.focus === f || cuisinesOf(s).includes(f);
}
