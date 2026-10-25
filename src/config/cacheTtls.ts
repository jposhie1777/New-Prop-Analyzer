export interface CachePolicy {
  sMaxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
  immutable?: boolean;
}

export const cachePolicies = {
  schedule: { sMaxAgeSeconds: 300, staleWhileRevalidateSeconds: 600 }, // 5 min
  seasonDates: { sMaxAgeSeconds: 3600, staleWhileRevalidateSeconds: 7200 }, // 1 hour, list of dates that have games
  injuries: { sMaxAgeSeconds: 600, staleWhileRevalidateSeconds: 1200 }, // 10 min
  openingOdds: { sMaxAgeSeconds: 600, staleWhileRevalidateSeconds: 1200 }, // 10 min
  openingProps: { sMaxAgeSeconds: 600, staleWhileRevalidateSeconds: 1200 }, // 10 min
  liveBoxScores: { sMaxAgeSeconds: 30, staleWhileRevalidateSeconds: 30 }, // 30 s
  liveOdds: { sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 60 }, // 60 s
  liveProps: { sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 60 }, // 60 s
  livePlays: { sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 60 }, // 60 s, play-by-play for live games
  finishedDate: { sMaxAgeSeconds: 2592000, staleWhileRevalidateSeconds: 0, immutable: true }, // 30 days, finished dates never change
  unfinishedDate: { sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 60 }, // a past date with a game not yet final
  players: { sMaxAgeSeconds: 86400, staleWhileRevalidateSeconds: 86400 }, // 1 day, player search
  appConfig: { sMaxAgeSeconds: 300, staleWhileRevalidateSeconds: 600 }, // 5 min
} satisfies Record<string, CachePolicy>;

export type CachePolicyName = keyof typeof cachePolicies;

export function buildCacheControlHeader(policy: CachePolicy): string {
  const directives = ["public", "max-age=0", `s-maxage=${policy.sMaxAgeSeconds}`]; // browser revalidates, CDN holds the copy
  if (policy.immutable) directives.push("immutable");
  else if (policy.staleWhileRevalidateSeconds > 0) directives.push(`stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`);
  return directives.join(", ");
}
