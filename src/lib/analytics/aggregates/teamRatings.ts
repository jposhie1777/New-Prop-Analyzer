import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber, sqlNumberList, sqlString } from "@/lib/analytics/engine";

export interface RatingSample {
  games: number;
  offense: number; // points per 100 possessions
  defense: number; // points allowed per 100 possessions
  pace: number; // possessions per 48 minutes
  pointsFor: number;
  pointsAgainst: number;
}

export interface TeamRating {
  teamId: number;
  current: RatingSample | null;
  previous: RatingSample | null;
  recent: RatingSample | null; // last 10 games this season
  blended: { offense: number; defense: number; pace: number }; // what the model uses
  currentWeight: number; // how much this season counts vs. last season
}

export interface LeagueRatings {
  offense: number;
  pace: number;
  teams: Map<number, TeamRating>;
}

const priorGames = 8; // this season outweighs last season after about 8 games
const recentWeight = 0.3; // how much the last 10 games tilt the season number

interface SampleRow {
  team_id: number;
  bucket: string;
  games: number;
  points: number;
  opp_points: number;
  possessions: number;
  opp_possessions: number;
  minutes: number;
}

function sampleFrom(sampleRow: SampleRow | undefined): RatingSample | null {
  if (!sampleRow || Number(sampleRow.games) === 0) return null;
  const games = Number(sampleRow.games);
  const averagePossessions = (Number(sampleRow.possessions) + Number(sampleRow.opp_possessions)) / 2;
  if (averagePossessions <= 0) return null;
  const minutesPerGame = Number(sampleRow.minutes) / games;
  return {
    games,
    offense: (100 * Number(sampleRow.points)) / averagePossessions,
    defense: (100 * Number(sampleRow.opp_points)) / averagePossessions,
    pace: ((averagePossessions / games) * 48) / Math.max(1, minutesPerGame), // per 48 minutes, so overtime does not inflate it
    pointsFor: Number(sampleRow.points) / games,
    pointsAgainst: Number(sampleRow.opp_points) / games,
  };
}

export function blendRating(current: RatingSample | null, previous: RatingSample | null, recent: RatingSample | null, leagueFallback: { offense: number; pace: number }): { blended: TeamRating["blended"]; currentWeight: number } {
  const prior = previous ?? { offense: leagueFallback.offense, defense: leagueFallback.offense, pace: leagueFallback.pace };
  const currentWeight = current ? current.games / (current.games + priorGames) : 0;
  const mix = (metric: "offense" | "defense" | "pace") => {
    const seasonValue = current ? currentWeight * current[metric] + (1 - currentWeight) * prior[metric] : prior[metric];
    if (!recent || recent.games < 5) return seasonValue;
    return (1 - recentWeight) * seasonValue + recentWeight * recent[metric]; // recent form, once there is a real sample
  };
  return { blended: { offense: mix("offense"), defense: mix("defense"), pace: mix("pace") }, currentWeight };
}

export async function teamRatings(engine: AnalyticsEngine, currentSeason: number, beforeDate: string | null = null): Promise<LeagueRatings> {
  const sampleRows = await engine.query<SampleRow>(`
    WITH full_games AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY team_id, season ORDER BY game_date DESC, game_id DESC) AS recency
      FROM team_scope_lines WHERE scope = 'FG' AND season IN (${sqlNumberList([currentSeason, currentSeason - 1])}) ${beforeDate ? `AND game_date < ${sqlString(beforeDate)}` : ""}
    ),
    buckets AS (
      SELECT team_id, CASE WHEN season = ${sqlNumber(currentSeason)} THEN 'current' ELSE 'previous' END AS bucket, points, opp_points, possessions, opp_possessions, minutes FROM full_games
      UNION ALL SELECT team_id, 'recent' AS bucket, points, opp_points, possessions, opp_possessions, minutes FROM full_games WHERE season = ${sqlNumber(currentSeason)} AND recency <= 10
    )
    SELECT team_id, bucket, COUNT(*) AS games, CAST(SUM(points) AS DOUBLE) AS points, CAST(SUM(opp_points) AS DOUBLE) AS opp_points,
      CAST(SUM(possessions) AS DOUBLE) AS possessions, CAST(SUM(opp_possessions) AS DOUBLE) AS opp_possessions, CAST(SUM(minutes) AS DOUBLE) AS minutes
    FROM buckets GROUP BY team_id, bucket`);
  const byTeam = new Map<number, Partial<Record<"current" | "previous" | "recent", RatingSample | null>>>();
  for (const sampleRow of sampleRows) {
    const teamId = Number(sampleRow.team_id);
    const samples = byTeam.get(teamId) ?? {};
    samples[sampleRow.bucket as "current" | "previous" | "recent"] = sampleFrom(sampleRow);
    byTeam.set(teamId, samples);
  }
  const everySample = [...byTeam.values()].map((samples) => samples.current ?? samples.previous).filter((sample): sample is RatingSample => Boolean(sample));
  const leagueOffense = everySample.length > 0 ? everySample.reduce((runningTotal, sample) => runningTotal + sample.offense, 0) / everySample.length : 114;
  const leaguePace = everySample.length > 0 ? everySample.reduce((runningTotal, sample) => runningTotal + sample.pace, 0) / everySample.length : 99;
  const teams = new Map<number, TeamRating>();
  for (const [teamId, samples] of byTeam) {
    const { blended, currentWeight } = blendRating(samples.current ?? null, samples.previous ?? null, samples.recent ?? null, { offense: leagueOffense, pace: leaguePace });
    teams.set(teamId, { teamId, current: samples.current ?? null, previous: samples.previous ?? null, recent: samples.recent ?? null, blended, currentWeight });
  }
  const blendedOffense = [...teams.values()].reduce((runningTotal, rating) => runningTotal + rating.blended.offense, 0) / Math.max(1, teams.size);
  const blendedPace = [...teams.values()].reduce((runningTotal, rating) => runningTotal + rating.blended.pace, 0) / Math.max(1, teams.size);
  return { offense: teams.size > 0 ? blendedOffense : leagueOffense, pace: teams.size > 0 ? blendedPace : leaguePace, teams };
}

export interface InjuredScorer {
  playerId: number;
  teamId: number;
  pointsPerGame: number;
  minutesPerGame: number;
  playedRecently: boolean; // played in one of the team's last 3 games, so his absence is not yet in the team numbers
}

export async function injuredScorers(engine: AnalyticsEngine, playerIds: number[], season: number): Promise<Map<number, InjuredScorer>> {
  if (playerIds.length === 0) return new Map();
  const scorerRows = await engine.query<{ player_id: number; team_id: number; points: number; minutes: number; played_recently: boolean }>(`
    WITH team_recent AS (
      SELECT team_id, game_id, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY game_date DESC, game_id DESC) AS recency
      FROM (SELECT DISTINCT team_id, game_id, game_date FROM player_game_stats WHERE season IN (${sqlNumberList([season, season - 1])}))
    ),
    player_lines AS (
      SELECT player_id, team_id, game_id, pts, minutes, season FROM player_game_stats
      WHERE player_id IN (${sqlNumberList(playerIds)}) AND season IN (${sqlNumberList([season, season - 1])}) AND minutes > 0
    )
    SELECT player_lines.player_id, arg_max(player_lines.team_id, player_lines.game_id) AS team_id,
      CAST(AVG(player_lines.pts) AS DOUBLE) AS points, CAST(AVG(player_lines.minutes) AS DOUBLE) AS minutes,
      bool_or(team_recent.recency <= 3) AS played_recently
    FROM player_lines LEFT JOIN team_recent ON team_recent.team_id = player_lines.team_id AND team_recent.game_id = player_lines.game_id
    GROUP BY player_lines.player_id`);
  return new Map(
    scorerRows.map((scorerRow) => [
      Number(scorerRow.player_id),
      { playerId: Number(scorerRow.player_id), teamId: Number(scorerRow.team_id), pointsPerGame: Number(scorerRow.points), minutesPerGame: Number(scorerRow.minutes), playedRecently: Boolean(scorerRow.played_recently) },
    ]),
  );
}
