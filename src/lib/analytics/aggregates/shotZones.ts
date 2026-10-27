import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber } from "@/lib/analytics/engine";
import { shotZoneKeys, type ShotZoneKey } from "@/lib/data/shotZones";

export type ShotWindow = "season" | "last10" | "last5";

export const shotWindowLimits: Record<ShotWindow, number | null> = { season: null, last10: 10, last5: 5 };

export interface ZoneLine {
  zone: ShotZoneKey;
  attempts: number;
  makes: number;
  games: number;
  percent: number | null; // raw make rate
  perGame: number; // attempts per game
}

export interface DefenseZoneLine extends ZoneLine {
  rank: number | null; // 1 = lowest make rate allowed (toughest), 30 = softest
  teams: number;
}

export interface ZoneComparison {
  zone: ShotZoneKey;
  player: ZoneLine;
  defense: DefenseZoneLine | null;
  leaguePercent: number | null;
  playerShrunk: number | null; // pulled toward the league rate until the sample is real
  defenseShrunk: number | null;
  edge: number | null; // player edge over league + defense leak over league, in make-rate points
  shotShare: number; // share of his attempts from this zone
}

const playerPriorAttempts = 12; // a player's zone rate needs about this many tries to count
const defensePriorAttempts = 40;

function emptyLine(zone: ShotZoneKey): ZoneLine {
  return { zone, attempts: 0, makes: 0, games: 0, percent: null, perGame: 0 };
}

function shrink(makes: number, attempts: number, leagueRate: number | null, priorAttempts: number): number | null {
  if (leagueRate === null) return attempts > 0 ? makes / attempts : null;
  return (makes + priorAttempts * leagueRate) / (attempts + priorAttempts);
}

export async function shotZoneSeasons(engine: AnalyticsEngine): Promise<number[]> {
  const seasonRows = await engine.query<{ season: number }>("SELECT DISTINCT season FROM shot_zones ORDER BY season DESC");
  return seasonRows.map((seasonRow) => Number(seasonRow.season));
}

export async function leagueZoneRates(engine: AnalyticsEngine, season: number): Promise<Map<ShotZoneKey, number>> {
  const rateRows = await engine.query<{ zone: ShotZoneKey; attempts: number; makes: number }>(`SELECT zone, CAST(SUM(attempts) AS INTEGER) AS attempts, CAST(SUM(makes) AS INTEGER) AS makes FROM shot_zones WHERE season = ${sqlNumber(season)} GROUP BY zone`);
  return new Map(rateRows.filter((rateRow) => Number(rateRow.attempts) > 0).map((rateRow) => [rateRow.zone, Number(rateRow.makes) / Number(rateRow.attempts)]));
}

export async function playerShotZones(engine: AnalyticsEngine, playerId: number, season: number, window: ShotWindow): Promise<{ lines: Map<ShotZoneKey, ZoneLine>; games: number }> {
  const gameLimit = shotWindowLimits[window];
  const zoneRows = await engine.query<{ zone: ShotZoneKey; attempts: number; makes: number; games: number }>(`
    WITH chosen_games AS (
      SELECT game_id FROM (SELECT DISTINCT game_id, game_date FROM shot_zones WHERE player_id = ${sqlNumber(playerId)} AND season = ${sqlNumber(season)})
      ORDER BY game_date DESC, game_id DESC ${gameLimit ? `LIMIT ${sqlNumber(gameLimit)}` : ""}
    )
    SELECT zone, CAST(SUM(attempts) AS INTEGER) AS attempts, CAST(SUM(makes) AS INTEGER) AS makes, (SELECT COUNT(*) FROM chosen_games) AS games
    FROM shot_zones WHERE player_id = ${sqlNumber(playerId)} AND game_id IN (SELECT game_id FROM chosen_games)
    GROUP BY zone`);
  const games = Number(zoneRows[0]?.games ?? 0);
  const lines = new Map<ShotZoneKey, ZoneLine>(shotZoneKeys.map((zone) => [zone, emptyLine(zone)]));
  for (const zoneRow of zoneRows) {
    const attempts = Number(zoneRow.attempts);
    const makes = Number(zoneRow.makes);
    lines.set(zoneRow.zone, { zone: zoneRow.zone, attempts, makes, games, percent: attempts > 0 ? makes / attempts : null, perGame: games > 0 ? attempts / games : 0 });
  }
  return { lines, games };
}

export async function defenseShotZones(engine: AnalyticsEngine, season: number, window: ShotWindow): Promise<Map<number, Map<ShotZoneKey, DefenseZoneLine>>> {
  const gameLimit = shotWindowLimits[window];
  const zoneRows = await engine.query<{ defense_team_id: number; zone: ShotZoneKey; attempts: number; makes: number; games: number }>(`
    WITH defense_games AS (
      SELECT opponent_team_id AS defense_team_id, game_id, ROW_NUMBER() OVER (PARTITION BY opponent_team_id ORDER BY game_date DESC, game_id DESC) AS recency
      FROM (SELECT DISTINCT opponent_team_id, game_id, game_date FROM shot_zones WHERE season = ${sqlNumber(season)})
    ),
    chosen AS (SELECT defense_team_id, game_id FROM defense_games ${gameLimit ? `WHERE recency <= ${sqlNumber(gameLimit)}` : ""}),
    game_counts AS (SELECT defense_team_id, COUNT(*) AS games FROM chosen GROUP BY defense_team_id)
    SELECT chosen.defense_team_id, zone_line.zone, CAST(SUM(zone_line.attempts) AS INTEGER) AS attempts, CAST(SUM(zone_line.makes) AS INTEGER) AS makes, any_value(game_counts.games) AS games
    FROM chosen
    JOIN shot_zones AS zone_line ON zone_line.game_id = chosen.game_id AND zone_line.opponent_team_id = chosen.defense_team_id
    JOIN game_counts ON game_counts.defense_team_id = chosen.defense_team_id
    GROUP BY chosen.defense_team_id, zone_line.zone`); // shots taken against each team, over that team's last N games
  const byTeam = new Map<number, Map<ShotZoneKey, DefenseZoneLine>>();
  for (const zoneRow of zoneRows) {
    const teamId = Number(zoneRow.defense_team_id);
    const attempts = Number(zoneRow.attempts);
    const makes = Number(zoneRow.makes);
    const games = Number(zoneRow.games);
    const teamLines = byTeam.get(teamId) ?? new Map<ShotZoneKey, DefenseZoneLine>();
    teamLines.set(zoneRow.zone, { zone: zoneRow.zone, attempts, makes, games, percent: attempts > 0 ? makes / attempts : null, perGame: games > 0 ? attempts / games : 0, rank: null, teams: 0 });
    byTeam.set(teamId, teamLines);
  }
  for (const zone of shotZoneKeys) {
    const ranked = [...byTeam.values()].map((teamLines) => teamLines.get(zone)).filter((zoneLine): zoneLine is DefenseZoneLine => Boolean(zoneLine && zoneLine.percent !== null && zoneLine.attempts >= 5));
    ranked.sort((first, second) => (first.percent ?? 0) - (second.percent ?? 0)); // lowest make rate allowed is rank 1
    ranked.forEach((zoneLine, rankIndex) => {
      zoneLine.rank = rankIndex + 1;
      zoneLine.teams = ranked.length;
    });
  }
  return byTeam;
}

export function compareZones(playerLines: Map<ShotZoneKey, ZoneLine>, defenseLines: Map<ShotZoneKey, DefenseZoneLine> | null, leagueRates: Map<ShotZoneKey, number>): ZoneComparison[] {
  const totalAttempts = [...playerLines.values()].reduce((runningTotal, zoneLine) => runningTotal + zoneLine.attempts, 0);
  return shotZoneKeys.map((zone) => {
    const player = playerLines.get(zone) ?? emptyLine(zone);
    const defense = defenseLines?.get(zone) ?? null;
    const leaguePercent = leagueRates.get(zone) ?? null;
    const playerShrunk = player.attempts > 0 ? shrink(player.makes, player.attempts, leaguePercent, playerPriorAttempts) : null;
    const defenseShrunk = defense ? shrink(defense.makes, defense.attempts, leaguePercent, defensePriorAttempts) : null;
    const edge = leaguePercent !== null && playerShrunk !== null ? playerShrunk - leaguePercent + (defenseShrunk !== null ? defenseShrunk - leaguePercent : 0) : null;
    return { zone, player, defense, leaguePercent, playerShrunk, defenseShrunk, edge, shotShare: totalAttempts > 0 ? player.attempts / totalAttempts : 0 };
  });
}

export async function playerShotSeasons(engine: AnalyticsEngine, playerId: number): Promise<Map<number, number>> {
  const seasonRows = await engine.query<{ season: number; games: number }>(`SELECT season, COUNT(DISTINCT game_id) AS games FROM shot_zones WHERE player_id = ${sqlNumber(playerId)} GROUP BY season`);
  return new Map(seasonRows.map((seasonRow) => [Number(seasonRow.season), Number(seasonRow.games)]));
}

export function defaultShotSeason(seasons: number[], playerGames: Map<number, number> | null, minimumGames = 5): number | null {
  if (seasons.length === 0) return null;
  if (!playerGames) return seasons[0];
  return seasons.find((season) => (playerGames.get(season) ?? 0) >= minimumGames) ?? seasons.find((season) => (playerGames.get(season) ?? 0) > 0) ?? seasons[0]; // newest season with a real sample
}
