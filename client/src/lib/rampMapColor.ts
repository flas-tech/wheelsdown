import type { RampMapField } from "@shared/rampChecks";
export const rampColor = (f: Pick<RampMapField, "active" | "hot">) => (f.active ? "#DC2626" : f.hot ? "#F59E0B" : "#64748B");
