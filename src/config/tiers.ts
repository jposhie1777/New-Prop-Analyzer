export type BdlTier = "goat" | "allstar" | "trial" | "free" | "mock";

export const tierRequestsPerMinute: Record<BdlTier, number> = {
  goat: 600, // GOAT tier limit
  allstar: 60, // ALL-STAR tier: no odds, props or lineups
  trial: 5,
  free: 5,
  mock: 100000, // fixtures, no real calls
};

export const goatMonthlyPriceUsd = 39.99; // BALLDONTLIE GOAT subscription

export function resolveTier(rawTier: string | undefined): BdlTier {
  const normalizedTier = (rawTier ?? "").trim().toLowerCase();
  if (normalizedTier === "goat" || normalizedTier === "allstar" || normalizedTier === "trial" || normalizedTier === "free" || normalizedTier === "mock") return normalizedTier;
  return "mock"; // safest default: no key needed and nothing billable
}

export function tierHasGoatEndpoints(tier: BdlTier): boolean {
  return tier === "goat" || tier === "mock"; // odds, props, advanced v2, lineups, plays need GOAT
}
