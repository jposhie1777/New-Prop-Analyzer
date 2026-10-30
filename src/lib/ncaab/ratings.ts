import type { GameBox, PlayerBox } from "./boxScore";
import { normalCdf } from "@/lib/math/probability";
import type { GameProjection, OutcomeSpread, TooFarLimits } from "@/lib/analytics/gameModel";

export const ncaabHomeCourtPoints = 3.2; // college home court is worth about 3 points
export const ncaabOutcomeSpread: OutcomeSpread = { margin: 11.5, total: 16 }; // how far final margins and totals land from a good line
export const ncaabTooFarLimits: TooFarLimits = { spread: 8, total: 12, winChance: 0.2 };
const priorGames = 6; // this season's numbers count fully after about this many more games
const iterations = 20;

export interface TeamRatingLine {
  offense: number; // points per 100 possessions vs an average defense
  defense: number; // points allowed per 100 vs an average offense
  tempo: number; // possessions per 40 minutes vs an average opponent
  games: number;
}

export interface NcaabTeamRating {
  teamId: number;
  season: TeamRatingLine | null; // this season only
  prior: TeamRatingLine | null; // last season, regressed by how much production came back
  blended: TeamRatingLine; // what the model uses
  returningShare: number | null; // last-season points on this year's roster, vs. what the team scored
  netRank: number | null; // 1 = best offense minus defense
}

export interface LeagueAverages {
  efficiency: number;
  tempo: number;
}

export function leagueAverages(boxes: GameBox[]): LeagueAverages {
  const sides = boxes.flatMap((box) => [
    { points: box.home.points, possessions: box.possessions },
    { points: box.away.points, possessions: box.possessions },
  ]).filter((side) => side.possessions > 30);
  if (sides.length === 0) return { efficiency: 104, tempo: 68 };
  const points = sides.reduce((runningTotal, side) => runningTotal + side.points, 0);
  const possessions = sides.reduce((runningTotal, side) => runningTotal + side.possessions, 0);
  return { efficiency: (points / possessions) * 100, tempo: possessions / sides.length };
}

export function adjustedRatings(boxes: GameBox[], league: LeagueAverages): Map<number, TeamRatingLine> {
  interface Sample {
    opponentId: number;
    offense: number;
    defense: number;
    tempo: number;
  }
  const samples = new Map<number, Sample[]>();
  for (const box of boxes) {
    if (box.possessions < 30 || !box.quality.pointsMatch) continue; // skip games the play-by-play could not rebuild
    const sideShift = ((ncaabHomeCourtPoints / 2) / box.possessions) * 100; // home court in points per 100
    const add = (teamId: number, opponentId: number, scored: number, allowed: number, atHome: boolean) => {
      const list = samples.get(teamId) ?? [];
      const shift = atHome ? sideShift : -sideShift;
      list.push({ opponentId, offense: (scored / box.possessions) * 100 - shift, defense: (allowed / box.possessions) * 100 + shift, tempo: box.possessions });
      samples.set(teamId, list);
    };
    add(box.homeTeamId, box.awayTeamId, box.home.points, box.away.points, true);
    add(box.awayTeamId, box.homeTeamId, box.away.points, box.home.points, false);
  }
  let ratings = new Map<number, TeamRatingLine>([...samples.entries()].map(([teamId, list]) => [teamId, { offense: league.efficiency, defense: league.efficiency, tempo: league.tempo, games: list.length }]));
  for (let round = 0; round < iterations; round++) {
    const next = new Map<number, TeamRatingLine>();
    for (const [teamId, list] of samples) {
      const opponent = (opponentId: number) => ratings.get(opponentId) ?? { offense: league.efficiency, defense: league.efficiency, tempo: league.tempo, games: 0 };
      const average = (values: number[]) => values.reduce((runningTotal, value) => runningTotal + value, 0) / values.length;
      next.set(teamId, {
        offense: average(list.map((sample) => (sample.offense * league.efficiency) / opponent(sample.opponentId).defense)),
        defense: average(list.map((sample) => (sample.defense * league.efficiency) / opponent(sample.opponentId).offense)),
        tempo: average(list.map((sample) => (sample.tempo * league.tempo) / opponent(sample.opponentId).tempo)),
        games: list.length,
      });
    }
    ratings = next;
  }
  return ratings;
}

export function returningShares(lastSeasonPlayers: PlayerBox[], currentRoster: Map<number, number>): Map<number, number> {
  const scoredByTeam = new Map<number, number>();
  const returningByTeam = new Map<number, number>();
  for (const line of lastSeasonPlayers) scoredByTeam.set(line.teamId, (scoredByTeam.get(line.teamId) ?? 0) + line.points);
  for (const line of lastSeasonPlayers) {
    if (line.playerId === null) continue;
    const currentTeam = currentRoster.get(line.playerId);
    if (currentTeam !== undefined) returningByTeam.set(currentTeam, (returningByTeam.get(currentTeam) ?? 0) + line.points); // returners and transfers count for their new team
  }
  const shares = new Map<number, number>();
  for (const [teamId, scored] of scoredByTeam) if (scored > 0) shares.set(teamId, Math.min(1.3, (returningByTeam.get(teamId) ?? 0) / scored));
  return shares;
}

export function blendRatings(season: Map<number, TeamRatingLine>, lastSeason: Map<number, TeamRatingLine>, league: LeagueAverages, lastLeague: LeagueAverages, shares: Map<number, number>, teamIds: number[]): Map<number, NcaabTeamRating> {
  const result = new Map<number, NcaabTeamRating>();
  for (const teamId of teamIds) {
    const current = season.get(teamId) ?? null;
    const last = lastSeason.get(teamId) ?? null;
    const share = shares.get(teamId) ?? null;
    const carry = 0.35 + 0.45 * Math.min(1, share ?? 0.5); // more returning production, more of last season carries over
    const prior: TeamRatingLine | null = last
      ? {
          offense: league.efficiency + (last.offense - lastLeague.efficiency) * carry,
          defense: league.efficiency + (last.defense - lastLeague.efficiency) * carry,
          tempo: league.tempo + (last.tempo - lastLeague.tempo) * 0.7,
          games: last.games,
        }
      : null;
    const base = prior ?? { offense: league.efficiency - 4, defense: league.efficiency + 4, tempo: league.tempo, games: 0 }; // unknown teams start below average
    const weight = current ? current.games / (current.games + priorGames) : 0;
    const blend = (seasonValue: number | undefined, priorValue: number) => (seasonValue === undefined ? priorValue : weight * seasonValue + (1 - weight) * priorValue);
    result.set(teamId, {
      teamId,
      season: current,
      prior,
      blended: { offense: blend(current?.offense, base.offense), defense: blend(current?.defense, base.defense), tempo: blend(current?.tempo, base.tempo), games: current?.games ?? 0 },
      returningShare: share,
      netRank: null,
    });
  }
  const ranked = [...result.values()].sort((first, second) => second.blended.offense - second.blended.defense - (first.blended.offense - first.blended.defense));
  ranked.forEach((rating, rankIndex) => (rating.netRank = rankIndex + 1));
  return result;
}

export function projectNcaabGame(home: TeamRatingLine, away: TeamRatingLine, league: LeagueAverages, neutral: boolean): GameProjection {
  const tempo = (home.tempo * away.tempo) / league.tempo;
  const homeCourt = neutral ? 0 : ncaabHomeCourtPoints;
  const homePoints = (tempo / 100) * ((home.offense * away.defense) / league.efficiency) + homeCourt / 2;
  const awayPoints = (tempo / 100) * ((away.offense * home.defense) / league.efficiency) - homeCourt / 2;
  const margin = homePoints - awayPoints;
  return {
    pace: tempo,
    homePoints,
    awayPoints,
    margin,
    total: homePoints + awayPoints,
    homeWinProbability: normalCdf(margin / ncaabOutcomeSpread.margin),
    factors: [
      { label: `Tempo ${tempo.toFixed(1)} possessions (league ${league.tempo.toFixed(1)})`, marginEffect: 0, totalEffect: 0 },
      { label: neutral ? "Neutral site" : `Home court +${ncaabHomeCourtPoints}`, marginEffect: homeCourt, totalEffect: 0 },
    ],
  };
}
