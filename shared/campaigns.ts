// Tracked share links: getwheelsdown.com/go/<code>. Each code says where people came from (the channel), and
// optionally credits a member's invite (ref) so sign-ups from their own channel count toward their referrals.
export const CAMPAIGNS: Record<string, { label: string; ref?: number }> = {
  yt: { label: "PJ's YouTube", ref: 7 },
};
export const campaignCode = (raw: unknown) => {
  const c = String(raw || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
  return c && CAMPAIGNS[c] ? c : "";
};
