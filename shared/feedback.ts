export const FEEDBACK_KINDS = [
  ["idea", "Idea or request"], ["bug", "Something's broken"], ["listing", "Problem with a listing"], ["praise", "Something I like"], ["other", "Other"],
] as const;
export type FeedbackKind = typeof FEEDBACK_KINDS[number][0];
export const FEEDBACK_LABEL: Record<string, string> = Object.fromEntries(FEEDBACK_KINDS);
export const FEEDBACK_STATUSES = ["new", "reviewing", "done", "archived"] as const;
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number];
export const FEEDBACK_MAX = 2000;
export type FeedbackItem = {
  id: number; kind: string; message: string; page: string; device: string; status: FeedbackStatus; adminNote: string; createdAt: number; updatedAt: number;
  userId: number | null; userName: string | null; handle: string | null; contact: string;
};
