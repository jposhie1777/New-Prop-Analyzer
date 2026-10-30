import { resolveTier, type BdlTier } from "@/config/tiers";

export function ncaabTier(): BdlTier {
  if (process.env.NCAAB_TIER) return resolveTier(process.env.NCAAB_TIER);
  return resolveTier(process.env.BDL_TIER) === "mock" ? "mock" : "allstar"; // same BDL key, but college is on the ALL-STAR plan (60 calls a minute)
}
