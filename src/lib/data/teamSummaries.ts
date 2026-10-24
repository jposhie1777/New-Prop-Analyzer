import type { BdlGame, BdlPlay } from "@/lib/bdl/types";
import type { DataRow } from "./rowSchemas";

export interface TeamPeriodCounts {
  points: number;
  fieldGoalAttempts: number;
  freeThrowAttempts: number;
  offensiveRebounds: number;
  turnovers: number;
}

export function estimatePossessions(counts: Pick<TeamPeriodCounts, "fieldGoalAttempts" | "freeThrowAttempts" | "offensiveRebounds" | "turnovers">): number {
  return Math.max(0, counts.fieldGoalAttempts - counts.offensiveRebounds + counts.turnovers + 0.44 * counts.freeThrowAttempts); // standard box-score possession estimate
}

export function periodLengthMinutes(periodNumber: number): number {
  return periodNumber <= 4 ? 12 : 5; // overtime periods are five minutes
}

export function paceFor(possessions: number, opponentPossessions: number, periodMinutes: number): number {
  if (periodMinutes <= 0) return 0;
  return ((possessions + opponentPossessions) / 2) * (48 / periodMinutes); // possessions per 48 minutes
}

function emptyCounts(): TeamPeriodCounts {
  return { points: 0, fieldGoalAttempts: 0, freeThrowAttempts: 0, offensiveRebounds: 0, turnovers: 0 };
}

function playDescription(play: BdlPlay): string {
  return `${play.type ?? ""} ${play.text ?? ""}`.toLowerCase();
}

export function isFreeThrowPlay(play: BdlPlay): boolean {
  return playDescription(play).includes("free throw");
}

export function isFieldGoalAttempt(play: BdlPlay): boolean {
  return Boolean(play.shooting_play) && !isFreeThrowPlay(play);
}

export function isOffensiveRebound(play: BdlPlay): boolean {
  return playDescription(play).includes("offensive rebound");
}

export function isTurnover(play: BdlPlay): boolean {
  return playDescription(play).includes("turnover");
}

export function countPlaysByTeamPeriod(plays: BdlPlay[], homeTeamId: number, visitorTeamId: number): Map<string, TeamPeriodCounts> {
  const countsByKey = new Map<string, TeamPeriodCounts>();
  const countsFor = (teamId: number, periodNumber: number) => {
    const mapKey = `${teamId}:${periodNumber}`;
    let counts = countsByKey.get(mapKey);
    if (!counts) {
      counts = emptyCounts();
      countsByKey.set(mapKey, counts);
    }
    return counts;
  };
  const orderedPlays = [...plays].sort((first, second) => first.order - second.order);
  const periodEndScores = new Map<number, { home: number; away: number }>();
  for (const play of orderedPlays) {
    if (!play.period) continue;
    countsFor(homeTeamId, play.period);
    countsFor(visitorTeamId, play.period);
    const previousEnd = periodEndScores.get(play.period);
    periodEndScores.set(play.period, { home: Math.max(previousEnd?.home ?? 0, play.home_score ?? 0), away: Math.max(previousEnd?.away ?? 0, play.away_score ?? 0) });
    const teamId = play.team?.id;
    if (!teamId) continue;
    const counts = countsFor(teamId, play.period);
    if (isFieldGoalAttempt(play)) counts.fieldGoalAttempts += 1;
    if (isFreeThrowPlay(play)) counts.freeThrowAttempts += 1;
    if (isOffensiveRebound(play)) counts.offensiveRebounds += 1;
    if (isTurnover(play)) counts.turnovers += 1;
  }
  const periodNumbers = [...periodEndScores.keys()].sort((first, second) => first - second);
  let previousHome = 0;
  let previousAway = 0;
  for (const periodNumber of periodNumbers) {
    const endScore = periodEndScores.get(periodNumber)!;
    countsFor(homeTeamId, periodNumber).points = endScore.home - previousHome; // points from the running score, robust to play type naming
    countsFor(visitorTeamId, periodNumber).points = endScore.away - previousAway;
    previousHome = endScore.home;
    previousAway = endScore.away;
  }
  return countsByKey;
}

export function buildTeamPeriodSummaries(game: BdlGame, plays: BdlPlay[], periodStatRows: DataRow[]): DataRow[] {
  const homeTeamId = game.home_team.id;
  const visitorTeamId = game.visitor_team.id;
  const playCounts = countPlaysByTeamPeriod(plays, homeTeamId, visitorTeamId);
  const boxCounts = new Map<string, TeamPeriodCounts>(); // fallback when play-by-play is missing or unrecognized
  for (const statRow of periodStatRows) {
    const mapKey = `${statRow.team_id}:${statRow.period}`;
    const counts = boxCounts.get(mapKey) ?? emptyCounts();
    counts.points += Number(statRow.pts ?? 0);
    counts.fieldGoalAttempts += Number(statRow.fga ?? 0);
    counts.freeThrowAttempts += Number(statRow.fta ?? 0);
    counts.offensiveRebounds += Number(statRow.oreb ?? 0);
    counts.turnovers += Number(statRow.turnover ?? 0);
    boxCounts.set(mapKey, counts);
  }
  const periodNumbers = new Set<number>();
  for (const mapKey of [...playCounts.keys(), ...boxCounts.keys()]) periodNumbers.add(Number(mapKey.split(":")[1]));
  const summaryRows: DataRow[] = [];
  for (const periodNumber of [...periodNumbers].sort((first, second) => first - second)) {
    const resolved = new Map<number, { counts: TeamPeriodCounts; source: string; possessions: number }>();
    for (const teamId of [homeTeamId, visitorTeamId]) {
      const fromPlays = playCounts.get(`${teamId}:${periodNumber}`);
      const fromBox = boxCounts.get(`${teamId}:${periodNumber}`);
      const playsUsable = fromPlays && fromPlays.fieldGoalAttempts > 0;
      const counts = playsUsable ? fromPlays : (fromBox ?? fromPlays ?? emptyCounts());
      if (!playsUsable && fromPlays && fromPlays.points > 0) counts.points = fromPlays.points; // keep play-by-play scoring even if counts fell back
      resolved.set(teamId, { counts, source: playsUsable ? "play_by_play" : fromBox ? "box_score" : "none", possessions: estimatePossessions(counts) });
    }
    const periodMinutes = periodLengthMinutes(periodNumber);
    for (const teamId of [homeTeamId, visitorTeamId]) {
      const opponentId = teamId === homeTeamId ? visitorTeamId : homeTeamId;
      const ownSide = resolved.get(teamId)!;
      const opponent = resolved.get(opponentId)!;
      summaryRows.push({
        season: game.season,
        game_date: game.date,
        game_id: game.id,
        team_id: teamId,
        opponent_team_id: opponentId,
        is_home: teamId === homeTeamId,
        period: periodNumber,
        period_minutes: periodMinutes,
        points: ownSide.counts.points,
        opp_points: opponent.counts.points,
        field_goal_attempts: ownSide.counts.fieldGoalAttempts,
        free_throw_attempts: ownSide.counts.freeThrowAttempts,
        offensive_rebounds: ownSide.counts.offensiveRebounds,
        turnovers: ownSide.counts.turnovers,
        possessions: Math.round(ownSide.possessions * 100) / 100,
        opp_possessions: Math.round(opponent.possessions * 100) / 100,
        pace: Math.round(paceFor(ownSide.possessions, opponent.possessions, periodMinutes) * 100) / 100,
        possessions_source: ownSide.source,
      });
    }
  }
  return summaryRows;
}
