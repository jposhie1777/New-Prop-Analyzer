import type { BdlBettingOdd } from "@/lib/bdl/types";
import type { TrackedPick } from "@/lib/tracking/tracker";
import type { GameBox, PlayerBox, ShootingLine } from "./boxScore";
import type { LeagueAverages, TeamRatingLine } from "./ratings";

export interface RatedTeam {
  id: number;
  college: string;
  name: string; // mascot
  abbreviation: string;
  conference: string | null;
  apRank: number | null; // AP top 25 this week
  wins: number;
  losses: number;
  blended: TeamRatingLine;
  season: TeamRatingLine | null;
  prior: TeamRatingLine | null;
  returningShare: number | null;
  netRank: number | null;
}

export interface RatingsFile {
  generatedAt: string;
  season: number;
  lastSeason: number;
  league: LeagueAverages;
  lastLeague: LeagueAverages;
  rankingsWeek: number | null;
  rankingsSeason: number | null;
  teams: RatedTeam[];
}

export interface TeamGameLog {
  gameId: number;
  date: string;
  season: number;
  opponentId: number;
  atHome: boolean;
  neutral: boolean;
  scored: number;
  allowed: number;
  possessions: number | null; // null when the play-by-play could not be rebuilt
  boxAvailable: boolean;
}

export interface PlayerAverage {
  name: string;
  playerId: number | null;
  season: number;
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  threesMade: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fieldGoalPercent: number | null;
  threePercent: number | null;
  freeThrowPercent: number | null;
}

export interface TeamFile {
  teamId: number;
  generatedAt: string;
  games: TeamGameLog[];
  playerAverages: PlayerAverage[];
}

export interface BoxFile extends GameBox {
  homeName: string;
  awayName: string;
}

export interface OddsPull {
  at: string;
  creditsRemaining: number | null;
  creditsUsed: number | null;
  events: number;
}

export interface OddsFile {
  date: string;
  pulls: OddsPull[];
  opening: Record<string, BdlBettingOdd[]>; // by BDL game id, first pull that saw the game
  current: Record<string, BdlBettingOdd[]>; // latest pull before tip-off
  unmatched: Array<{ home: string; away: string; commenceTime: string }>;
}

export interface PicksFile {
  date: string;
  picks: TrackedPick[];
}

export interface RecordFile {
  generatedAt: string;
  picks: TrackedPick[]; // graded and pending, this season
}

export interface MetaFile {
  generatedAt: string;
  boxes: Record<string, { games: number; rebuilt: number; pointsMatch: number }>; // by season
  callsUsed: number;
  backfillRemaining: number; // finished games still missing a box score
}

export function sumShooting<LineType extends ShootingLine>(lines: LineType[]): ShootingLine {
  const total: ShootingLine = { points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threesMade: 0, threesAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, turnovers: 0, steals: 0, blocks: 0, fouls: 0 };
  for (const line of lines) for (const statName of Object.keys(total) as Array<keyof ShootingLine>) total[statName] += line[statName];
  return total;
}

export function playerAverages(lines: PlayerBox[], season: number): PlayerAverage[] {
  const byPlayer = new Map<string, PlayerBox[]>();
  for (const line of lines) {
    const key = line.playerId !== null ? `id:${line.playerId}` : `name:${line.name.toLowerCase()}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), line]);
  }
  const ratio = (made: number, attempted: number) => (attempted > 0 ? made / attempted : null);
  return [...byPlayer.values()]
    .map((playerLines) => {
      const total = sumShooting(playerLines);
      const games = playerLines.length;
      const perGame = (value: number) => Math.round((value / games) * 10) / 10;
      return {
        name: playerLines[0].name,
        playerId: playerLines[0].playerId,
        season,
        games,
        points: perGame(total.points),
        rebounds: perGame(total.offensiveRebounds + total.defensiveRebounds),
        assists: perGame(total.assists),
        threesMade: perGame(total.threesMade),
        steals: perGame(total.steals),
        blocks: perGame(total.blocks),
        turnovers: perGame(total.turnovers),
        fieldGoalPercent: ratio(total.fieldGoalsMade, total.fieldGoalsAttempted),
        threePercent: ratio(total.threesMade, total.threesAttempted),
        freeThrowPercent: ratio(total.freeThrowsMade, total.freeThrowsAttempted),
      };
    })
    .sort((first, second) => second.points - first.points);
}
