export const windowNames = ["L5", "L10", "L20", "SEASON"] as const;
export type WindowName = (typeof windowNames)[number];

export const windowLimits: Record<WindowName, number | null> = { L5: 5, L10: 10, L20: 20, SEASON: null };

export interface MetricSummary {
  average: number | null;
  standardDeviation: number | null;
  games: number;
}

export function windowFilter(windowName: WindowName, recencyColumn = "recency"): string {
  const limit = windowLimits[windowName];
  return limit === null ? "TRUE" : `${recencyColumn} <= ${limit}`;
}

export function windowedAggregateColumns(metricNames: readonly string[], includeDeviation = true): string[] {
  const columns: string[] = [];
  for (const windowName of windowNames) {
    const filterClause = windowFilter(windowName);
    columns.push(`COUNT(*) FILTER (WHERE ${filterClause}) AS "games__${windowName}"`);
    for (const metricName of metricNames) {
      columns.push(`AVG("${metricName}") FILTER (WHERE ${filterClause}) AS "${metricName}__avg__${windowName}"`);
      if (includeDeviation) columns.push(`STDDEV_SAMP("${metricName}") FILTER (WHERE ${filterClause}) AS "${metricName}__sd__${windowName}"`);
    }
  }
  return columns;
}

export function readWindowSummary(aggregateRow: Record<string, unknown>, metricName: string, windowName: WindowName): MetricSummary {
  const averageValue = aggregateRow[`${metricName}__avg__${windowName}`];
  const deviationValue = aggregateRow[`${metricName}__sd__${windowName}`];
  return {
    average: typeof averageValue === "number" && Number.isFinite(averageValue) ? averageValue : null,
    standardDeviation: typeof deviationValue === "number" && Number.isFinite(deviationValue) ? deviationValue : null,
    games: Number(aggregateRow[`games__${windowName}`] ?? 0),
  };
}

export function rankDescending<ItemType>(items: ItemType[], valueOf: (item: ItemType) => number | null): Map<ItemType, number> {
  const ranked = items.filter((item) => valueOf(item) !== null).sort((first, second) => (valueOf(second) ?? 0) - (valueOf(first) ?? 0));
  const ranks = new Map<ItemType, number>();
  ranked.forEach((item, rankIndex) => {
    const previous = rankIndex > 0 ? ranked[rankIndex - 1] : null;
    ranks.set(item, previous !== null && valueOf(previous) === valueOf(item) ? ranks.get(previous)! : rankIndex + 1); // ties share a rank
  });
  return ranks;
}
