export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSigned(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

export function rankClass(rank: number | null, teamCount = 30): string {
  if (rank === null) return "rank-mid";
  if (rank <= Math.round(teamCount / 3)) return "rank-soft"; // allows a lot: good matchup for the player
  if (rank > Math.round((teamCount * 2) / 3)) return "rank-tough";
  return "rank-mid";
}
