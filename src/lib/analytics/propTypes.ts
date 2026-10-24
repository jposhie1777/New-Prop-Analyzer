import type { PlayerMetric, ScopeName } from "./views";

export interface PropMapping {
  metric: PlayerMetric;
  scope: ScopeName;
  label: string;
}

export const propTypeMappings: Record<string, PropMapping> = {
  points: { metric: "pts", scope: "FG", label: "Points" },
  rebounds: { metric: "reb", scope: "FG", label: "Rebounds" },
  assists: { metric: "ast", scope: "FG", label: "Assists" },
  threes: { metric: "fg3m", scope: "FG", label: "3PM" },
  steals: { metric: "stl", scope: "FG", label: "Steals" },
  blocks: { metric: "blk", scope: "FG", label: "Blocks" },
  points_rebounds_assists: { metric: "pra", scope: "FG", label: "PRA" },
  points_rebounds: { metric: "pr", scope: "FG", label: "Pts+Reb" },
  points_assists: { metric: "pa", scope: "FG", label: "Pts+Ast" },
  rebounds_assists: { metric: "ra", scope: "FG", label: "Reb+Ast" },
  points_1q: { metric: "pts", scope: "Q1", label: "1Q Points" },
  rebounds_1q: { metric: "reb", scope: "Q1", label: "1Q Rebounds" },
  assists_1q: { metric: "ast", scope: "Q1", label: "1Q Assists" },
};

export function propMapping(propType: string): PropMapping | null {
  return propTypeMappings[propType] ?? null; // milestone-only types like double_double are skipped
}
