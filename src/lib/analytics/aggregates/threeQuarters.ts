import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumberList, sqlString } from "@/lib/analytics/engine";
import { readWindowSummary, windowFilter, windowNames, windowedAggregateColumns, type MetricSummary, type WindowName } from "./windows";
import { probabilityAtLeast } from "@/lib/math/probability";
import { appSettings } from "@/config/appSettings";

export interface ThreeQuarterSeasonProfile {
  teamId: number;
  season: number;
  scored: Record<WindowName, MetricSummary>;
  allowed: Record<WindowName, MetricSummary>;
  pace: Record<WindowName, MetricSummary>;
  scoredHundred: Record<WindowName, number>;
  allowedHundred: Record<WindowName, number>;
  threeQuarterPoints: number;
  fullGamePoints: number;
}

export async function threeQuarterProfiles(engine: AnalyticsEngine, teamIds: number[], seasons: number[], beforeDate: string | null = null): Promise<ThreeQuarterSeasonProfile[]> {
  if (teamIds.length === 0) return [];
  const target = appSettings.hundredThroughThreeTarget;
  const hundredColumns = windowNames.flatMap((windowName) => [
    `COUNT(*) FILTER (WHERE ${windowFilter(windowName)} AND points >= ${target}) AS "scored_hundred__${windowName}"`,
    `COUNT(*) FILTER (WHERE ${windowFilter(windowName)} AND opp_points >= ${target}) AS "allowed_hundred__${windowName}"`,
  ]);
  const profileRows = await engine.query<Record<string, unknown>>(`
    WITH three_quarters AS (
      SELECT season, game_date, game_id, team_id, points, opp_points FROM team_scope_lines
      WHERE scope = 'T3' AND team_id IN (${sqlNumberList(teamIds)}) AND season IN (${sqlNumberList(seasons)}) ${beforeDate ? `AND game_date < ${sqlString(beforeDate)}` : ""}
    ),
    full_games AS (
      SELECT game_id, team_id, points AS full_points, (possessions + opp_possessions) / 2 * 48 / NULLIF(minutes, 0) AS pace_value FROM team_scope_lines WHERE scope = 'FG'
    ),
    joined AS (
      SELECT three_quarters.*, full_games.full_points, full_games.pace_value,
        ROW_NUMBER() OVER (PARTITION BY three_quarters.team_id, three_quarters.season ORDER BY three_quarters.game_date DESC, three_quarters.game_id DESC) AS recency
      FROM three_quarters JOIN full_games ON full_games.game_id = three_quarters.game_id AND full_games.team_id = three_quarters.team_id
    )
    SELECT team_id, season, SUM(points) AS three_quarter_points, SUM(full_points) AS full_game_points,
      ${windowedAggregateColumns(["points", "opp_points", "pace_value"]).join(", ")}, ${hundredColumns.join(", ")}
    FROM joined GROUP BY team_id, season`);
  return profileRows.map((profileRow) => {
    const byWindow = <ValueType,>(reader: (windowName: WindowName) => ValueType) => Object.fromEntries(windowNames.map((windowName) => [windowName, reader(windowName)])) as Record<WindowName, ValueType>;
    return {
      teamId: Number(profileRow.team_id),
      season: Number(profileRow.season),
      scored: byWindow((windowName) => readWindowSummary(profileRow, "points", windowName)),
      allowed: byWindow((windowName) => readWindowSummary(profileRow, "opp_points", windowName)),
      pace: byWindow((windowName) => readWindowSummary(profileRow, "pace_value", windowName)),
      scoredHundred: byWindow((windowName) => Number(profileRow[`scored_hundred__${windowName}`] ?? 0)),
      allowedHundred: byWindow((windowName) => Number(profileRow[`allowed_hundred__${windowName}`] ?? 0)),
      threeQuarterPoints: Number(profileRow.three_quarter_points ?? 0),
      fullGamePoints: Number(profileRow.full_game_points ?? 0),
    };
  });
}

export interface ShareEstimate {
  share: number | null;
  source: "current season" | "current + last season" | "last season" | "none";
  games: number;
}

export function estimateThreeQuarterShare(current: ThreeQuarterSeasonProfile | undefined, previous: ThreeQuarterSeasonProfile | undefined, minimumGames = 10): ShareEstimate {
  const currentGames = current?.scored.SEASON.games ?? 0;
  const previousGames = previous?.scored.SEASON.games ?? 0;
  if (current && currentGames >= minimumGames && current.fullGamePoints > 0) return { share: current.threeQuarterPoints / current.fullGamePoints, source: "current season", games: currentGames };
  const pooledThree = (current?.threeQuarterPoints ?? 0) + (previous?.threeQuarterPoints ?? 0);
  const pooledFull = (current?.fullGamePoints ?? 0) + (previous?.fullGamePoints ?? 0);
  if (pooledFull <= 0) return { share: null, source: "none", games: 0 };
  const source = currentGames > 0 && previousGames > 0 ? "current + last season" : currentGames > 0 ? "current season" : "last season"; // early season leans on last year
  return { share: pooledThree / pooledFull, source, games: currentGames + previousGames };
}

export function pickDeviation(current: ThreeQuarterSeasonProfile | undefined, previous: ThreeQuarterSeasonProfile | undefined): number {
  const currentDeviation = current?.scored.SEASON.standardDeviation ?? null;
  if (currentDeviation !== null && (current?.scored.SEASON.games ?? 0) >= 8) return currentDeviation;
  const previousDeviation = previous?.scored.SEASON.standardDeviation ?? null;
  return previousDeviation ?? currentDeviation ?? appSettings.defaultTeamThreeQuarterSd;
}

export interface ThreeQuarterProjection {
  projection: number | null;
  probability: number | null;
  standardDeviation: number;
}

export function projectThreeQuarters(impliedTeamTotal: number | null, threeQuarterShare: number | null, standardDeviation: number, target = appSettings.hundredThroughThreeTarget): ThreeQuarterProjection {
  if (impliedTeamTotal === null || threeQuarterShare === null) return { projection: null, probability: null, standardDeviation };
  const projection = impliedTeamTotal * threeQuarterShare;
  return { projection, probability: probabilityAtLeast(target, projection, standardDeviation), standardDeviation }; // P(points >= 100) with continuity correction
}

export const recentRatePriorGames = 10; // L20 rates this early in a season are 1-of-4 style samples, so they lean on last season

export function hundredRate(current: ThreeQuarterSeasonProfile | undefined, previous: ThreeQuarterSeasonProfile | undefined, side: "scored" | "allowed", baseRate: number): number {
  const hitsOf = (profile: ThreeQuarterSeasonProfile | undefined, windowName: WindowName) => (side === "scored" ? profile?.scoredHundred[windowName] : profile?.allowedHundred[windowName]) ?? 0;
  const gamesOf = (profile: ThreeQuarterSeasonProfile | undefined, windowName: WindowName) => (side === "scored" ? profile?.scored[windowName]?.games : profile?.allowed[windowName]?.games) ?? 0;
  const previousGames = gamesOf(previous, "SEASON");
  const priorRate = previousGames > 0 ? (hitsOf(previous, "SEASON") + recentRatePriorGames * baseRate) / (previousGames + recentRatePriorGames) : baseRate; // last season, itself shrunk toward the base
  const recentGames = current === previous ? 0 : gamesOf(current, "L20");
  return (hitsOf(current, "L20") * (recentGames > 0 ? 1 : 0) + recentRatePriorGames * priorRate) / (recentGames + recentRatePriorGames);
}

export function rateThreeQuarterChance(probability: number, teamScoredRate: number, opponentAllowedRate: number): number {
  return 0.6 * probability + 0.2 * teamScoredRate + 0.2 * opponentAllowedRate; // the line-based projection leads, recent 100+ history on both sides confirms it
}

export function selectThreeQuarterRecommendations<RowType extends { rating: number | null }>(rows: RowType[], minimumRating: number, maximumPicks: number): Set<RowType> {
  return new Set(
    rows
      .filter((row) => row.rating !== null && row.rating >= minimumRating)
      .sort((first, second) => (second.rating ?? 0) - (first.rating ?? 0))
      .slice(0, maximumPicks),
  );
}

export interface TeamThreeQuarterRating {
  share: ShareEstimate;
  projection: ThreeQuarterProjection;
  teamProfile: ThreeQuarterSeasonProfile | undefined;
  opponentProfile: ThreeQuarterSeasonProfile | undefined;
  profileSeason: number;
  teamScoredRate: number;
  opponentAllowedRate: number;
  rating: number | null; // before learning
}

function pickSeasonProfile(profiles: ThreeQuarterSeasonProfile[], teamId: number, currentSeason: number): { current: ThreeQuarterSeasonProfile | undefined; previous: ThreeQuarterSeasonProfile | undefined; shown: ThreeQuarterSeasonProfile | undefined; season: number } {
  const current = profiles.find((profile) => profile.teamId === teamId && profile.season === currentSeason);
  const previous = profiles.find((profile) => profile.teamId === teamId && profile.season === currentSeason - 1);
  if (current && current.scored.SEASON.games > 0) return { current, previous, shown: current, season: currentSeason };
  return { current, previous, shown: previous, season: currentSeason - 1 }; // no games yet this season
}

export function rateTeamForGame(profiles: ThreeQuarterSeasonProfile[], teamId: number, opponentId: number, impliedTeamTotal: number | null, currentSeason: number): TeamThreeQuarterRating {
  const team = pickSeasonProfile(profiles, teamId, currentSeason);
  const opponent = pickSeasonProfile(profiles, opponentId, currentSeason);
  const share = estimateThreeQuarterShare(team.current, team.previous);
  const projection = projectThreeQuarters(impliedTeamTotal, share.share, pickDeviation(team.current, team.previous));
  const teamScoredRate = hundredRate(team.current, team.previous, "scored", appSettings.hundredThroughThreeBaseRate);
  const opponentAllowedRate = hundredRate(opponent.current, opponent.previous, "allowed", appSettings.hundredThroughThreeBaseRate);
  return {
    share,
    projection,
    teamProfile: team.shown,
    opponentProfile: opponent.shown,
    profileSeason: team.season,
    teamScoredRate,
    opponentAllowedRate,
    rating: projection.probability === null ? null : rateThreeQuarterChance(projection.probability, teamScoredRate, opponentAllowedRate),
  };
}
