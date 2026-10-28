import type { AnalyticsEngine } from "@/lib/analytics/engine";
import { sqlNumber, sqlNumberList } from "@/lib/analytics/engine";
import { shotZoneKeys, threePointZones, type ShotZoneKey } from "@/lib/data/shotZones";
import { shotWindowLimits, type ShotWindow } from "./shotZones";

export type SpotFilter = "all" | "three" | "inside";

export const spotRules = {
  playerPriorAttempts: 12, // a player's zone rate needs about this many tries before it counts
  defensePriorAttempts: 40,
  minimumShotsPerGame: 6,
  minimumGames: 3,
  sweetSpotShotsPerGame: 1.5,
  sweetSpotSkill: 0.03, // he beats the league by 3+ points there
  sweetSpotLeak: 0.02, // the defense allows 2+ points over the league there
};

interface ZoneCount {
  attempts: number;
  makes: number;
}

export interface SlateShotData {
  season: number;
  league: Map<ShotZoneKey, number>;
  players: Array<{ playerId: number; name: string; teamId: number; games: number; zones: Map<ShotZoneKey, ZoneCount>; priorZones: Map<ShotZoneKey, ZoneCount> }>;
  defenses: Map<number, { games: number; zones: Map<ShotZoneKey, ZoneCount>; priorZones: Map<ShotZoneKey, ZoneCount> }>;
}

export interface SpotZone {
  zone: ShotZoneKey;
  perGame: number;
  attempts: number;
  makes: number;
  playerRate: number; // shrunk toward last season, then the league
  defenseRate: number;
  leagueRate: number;
  defenseRank: number | null; // 30 = allows the most
  skill: number; // player minus league
  leak: number; // defense minus league
  boost: number; // extra points tonight from this zone
  sweet: boolean;
}

export interface PlayerSpot {
  playerId: number;
  name: string;
  teamId: number;
  opponentId: number;
  gameId: number;
  games: number;
  shotsPerGame: number;
  boost: number; // extra points vs an average defense
  threeBoost: number; // extra made threes
  insideBoost: number;
  zones: SpotZone[];
}

export interface DefenseLeak {
  teamId: number;
  opponentId: number;
  gameId: number;
  zones: Array<{ zone: ShotZoneKey; rate: number; leak: number; rank: number | null; attackers: Array<{ playerId: number; name: string; perGame: number }> }>;
}

function addCount(target: Map<ShotZoneKey, ZoneCount>, zone: ShotZoneKey, attempts: number, makes: number): void {
  const existing = target.get(zone) ?? { attempts: 0, makes: 0 };
  target.set(zone, { attempts: existing.attempts + attempts, makes: existing.makes + makes });
}

export async function loadSlateShotData(engine: AnalyticsEngine, teamIds: number[], season: number, window: ShotWindow): Promise<SlateShotData> {
  const gameLimit = shotWindowLimits[window];
  const leagueRows = await engine.query<{ zone: ShotZoneKey; attempts: number; makes: number }>(`SELECT zone, CAST(SUM(attempts) AS INTEGER) AS attempts, CAST(SUM(makes) AS INTEGER) AS makes FROM shot_zones WHERE season IN (${sqlNumberList([season, season - 1])}) GROUP BY zone`);
  const league = new Map(leagueRows.filter((leagueRow) => Number(leagueRow.attempts) > 0).map((leagueRow) => [leagueRow.zone, Number(leagueRow.makes) / Number(leagueRow.attempts)]));
  const playerRows = await engine.query<{ player_id: number; team_id: number; zone: ShotZoneKey; attempts: number; makes: number; games: number; first_name: string | null; last_name: string | null }>(`
    WITH player_games AS (
      SELECT player_id, game_id, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC, game_id DESC) AS recency
      FROM (SELECT DISTINCT player_id, game_id, game_date FROM shot_zones WHERE season = ${sqlNumber(season)})
    ),
    latest_team AS (SELECT player_id, arg_max(team_id, game_date) AS team_id FROM shot_zones WHERE season = ${sqlNumber(season)} GROUP BY player_id),
    chosen AS (SELECT player_id, game_id FROM player_games ${gameLimit ? `WHERE recency <= ${sqlNumber(gameLimit)}` : ""}),
    game_counts AS (SELECT player_id, COUNT(*) AS games FROM chosen GROUP BY player_id),
    names AS (SELECT player_id, arg_max(first_name, last_seen_date) AS first_name, arg_max(last_name, last_seen_date) AS last_name FROM players GROUP BY player_id)
    SELECT zone_line.player_id, latest_team.team_id, zone_line.zone, CAST(SUM(zone_line.attempts) AS INTEGER) AS attempts, CAST(SUM(zone_line.makes) AS INTEGER) AS makes,
      any_value(game_counts.games) AS games, any_value(names.first_name) AS first_name, any_value(names.last_name) AS last_name
    FROM shot_zones AS zone_line
    JOIN chosen ON chosen.player_id = zone_line.player_id AND chosen.game_id = zone_line.game_id
    JOIN latest_team ON latest_team.player_id = zone_line.player_id
    JOIN game_counts ON game_counts.player_id = zone_line.player_id
    LEFT JOIN names ON names.player_id = zone_line.player_id
    WHERE latest_team.team_id IN (${sqlNumberList(teamIds)})
    GROUP BY zone_line.player_id, latest_team.team_id, zone_line.zone`);
  const playersById = new Map<number, SlateShotData["players"][number]>();
  for (const playerRow of playerRows) {
    const playerId = Number(playerRow.player_id);
    const entry = playersById.get(playerId) ?? { playerId, name: `${playerRow.first_name ?? ""} ${playerRow.last_name ?? ""}`.trim() || `Player ${playerId}`, teamId: Number(playerRow.team_id), games: Number(playerRow.games), zones: new Map(), priorZones: new Map() };
    addCount(entry.zones, playerRow.zone, Number(playerRow.attempts), Number(playerRow.makes));
    playersById.set(playerId, entry);
  }
  const playerIds = [...playersById.keys()];
  if (playerIds.length > 0) {
    const priorRows = await engine.query<{ player_id: number; zone: ShotZoneKey; attempts: number; makes: number }>(`SELECT player_id, zone, CAST(SUM(attempts) AS INTEGER) AS attempts, CAST(SUM(makes) AS INTEGER) AS makes FROM shot_zones WHERE season = ${sqlNumber(season - 1)} AND player_id IN (${sqlNumberList(playerIds)}) GROUP BY player_id, zone`);
    for (const priorRow of priorRows) {
      const entry = playersById.get(Number(priorRow.player_id));
      if (entry) addCount(entry.priorZones, priorRow.zone, Number(priorRow.attempts), Number(priorRow.makes));
    }
  }
  const defenseRows = await engine.query<{ defense_team_id: number; season: number; zone: ShotZoneKey; attempts: number; makes: number; games: number }>(`
    WITH defense_games AS (
      SELECT opponent_team_id AS defense_team_id, game_id, season, ROW_NUMBER() OVER (PARTITION BY opponent_team_id, season ORDER BY game_date DESC, game_id DESC) AS recency
      FROM (SELECT DISTINCT opponent_team_id, game_id, game_date, season FROM shot_zones WHERE season IN (${sqlNumberList([season, season - 1])}))
    ),
    chosen AS (SELECT defense_team_id, game_id, season FROM defense_games WHERE season = ${sqlNumber(season - 1)} OR (season = ${sqlNumber(season)} ${gameLimit ? `AND recency <= ${sqlNumber(gameLimit)}` : ""})),
    game_counts AS (SELECT defense_team_id, season, COUNT(*) AS games FROM chosen GROUP BY defense_team_id, season)
    SELECT chosen.defense_team_id, chosen.season, zone_line.zone, CAST(SUM(zone_line.attempts) AS INTEGER) AS attempts, CAST(SUM(zone_line.makes) AS INTEGER) AS makes, any_value(game_counts.games) AS games
    FROM chosen
    JOIN shot_zones AS zone_line ON zone_line.game_id = chosen.game_id AND zone_line.opponent_team_id = chosen.defense_team_id
    JOIN game_counts ON game_counts.defense_team_id = chosen.defense_team_id AND game_counts.season = chosen.season
    GROUP BY chosen.defense_team_id, chosen.season, zone_line.zone`); // last season is only the starting point, this season's window decides
  const defenses: SlateShotData["defenses"] = new Map();
  for (const defenseRow of defenseRows) {
    const teamId = Number(defenseRow.defense_team_id);
    const entry = defenses.get(teamId) ?? { games: 0, zones: new Map(), priorZones: new Map() };
    if (Number(defenseRow.season) === season) {
      addCount(entry.zones, defenseRow.zone, Number(defenseRow.attempts), Number(defenseRow.makes));
      entry.games = Number(defenseRow.games);
    } else addCount(entry.priorZones, defenseRow.zone, Number(defenseRow.attempts), Number(defenseRow.makes));
    defenses.set(teamId, entry);
  }
  return { season, league, players: [...playersById.values()], defenses };
}

function shrunkRate(count: ZoneCount | undefined, prior: ZoneCount | undefined, leagueRate: number, priorAttempts: number): number {
  const priorRate = prior && prior.attempts >= 10 ? (prior.makes + priorAttempts * leagueRate) / (prior.attempts + priorAttempts) : leagueRate; // last season, itself pulled toward the league
  return ((count?.makes ?? 0) + priorAttempts * priorRate) / ((count?.attempts ?? 0) + priorAttempts);
}

function defenseRates(data: SlateShotData): Map<number, Map<ShotZoneKey, { rate: number; rank: number | null }>> {
  const rates = new Map<number, Map<ShotZoneKey, { rate: number; rank: number | null }>>();
  for (const [teamId, defense] of data.defenses) {
    const zoneRates = new Map<ShotZoneKey, { rate: number; rank: number | null }>();
    for (const zone of shotZoneKeys) {
      const leagueRate = data.league.get(zone);
      if (leagueRate === undefined) continue;
      zoneRates.set(zone, { rate: shrunkRate(defense.zones.get(zone), defense.priorZones.get(zone), leagueRate, spotRules.defensePriorAttempts), rank: null });
    }
    rates.set(teamId, zoneRates);
  }
  for (const zone of shotZoneKeys) {
    const ordered = [...rates.values()].map((zoneRates) => zoneRates.get(zone)).filter((entry): entry is { rate: number; rank: number | null } => Boolean(entry)).sort((first, second) => first.rate - second.rate);
    ordered.forEach((entry, entryIndex) => (entry.rank = entryIndex + 1)); // 1 = allows the least
  }
  return rates;
}

export function zoneInFilter(zone: ShotZoneKey, filter: SpotFilter): boolean {
  if (filter === "three") return threePointZones.has(zone);
  if (filter === "inside") return !threePointZones.has(zone);
  return true;
}

export function filteredBoost(spot: PlayerSpot, filter: SpotFilter): number {
  return filter === "three" ? spot.threeBoost * 3 : filter === "inside" ? spot.insideBoost : spot.boost;
}

export function buildShootingSpots(data: SlateShotData, matchups: Array<{ teamId: number; opponentId: number; gameId: number }>, excludedPlayerIds: Set<number>): { players: PlayerSpot[]; defenses: DefenseLeak[] } {
  const rates = defenseRates(data);
  const matchupByTeam = new Map(matchups.map((matchup) => [matchup.teamId, matchup]));
  const players: PlayerSpot[] = [];
  for (const player of data.players) {
    const matchup = matchupByTeam.get(player.teamId);
    if (!matchup || excludedPlayerIds.has(player.playerId) || player.games < spotRules.minimumGames) continue;
    const totalAttempts = [...player.zones.values()].reduce((runningTotal, zoneCount) => runningTotal + zoneCount.attempts, 0);
    const shotsPerGame = totalAttempts / player.games;
    if (shotsPerGame < spotRules.minimumShotsPerGame) continue;
    const opponentRates = rates.get(matchup.opponentId);
    const zones: SpotZone[] = [];
    for (const zone of shotZoneKeys) {
      const leagueRate = data.league.get(zone);
      const count = player.zones.get(zone);
      if (leagueRate === undefined || !count || count.attempts === 0) continue;
      const perGame = count.attempts / player.games;
      const playerRate = shrunkRate(count, player.priorZones.get(zone), leagueRate, spotRules.playerPriorAttempts);
      const defense = opponentRates?.get(zone);
      const defenseRate = defense?.rate ?? leagueRate;
      const leak = defenseRate - leagueRate;
      const skill = playerRate - leagueRate;
      const pointValue = threePointZones.has(zone) ? 3 : 2;
      zones.push({ zone, perGame, attempts: count.attempts, makes: count.makes, playerRate, defenseRate, leagueRate, defenseRank: defense?.rank ?? null, skill, leak, boost: perGame * pointValue * leak, sweet: perGame >= spotRules.sweetSpotShotsPerGame && skill >= spotRules.sweetSpotSkill && leak >= spotRules.sweetSpotLeak });
    }
    zones.sort((first, second) => second.perGame - first.perGame);
    const sumBoost = (filter: SpotFilter) => zones.filter((spotZone) => zoneInFilter(spotZone.zone, filter)).reduce((runningTotal, spotZone) => runningTotal + spotZone.boost, 0);
    players.push({
      playerId: player.playerId,
      name: player.name,
      teamId: player.teamId,
      opponentId: matchup.opponentId,
      gameId: matchup.gameId,
      games: player.games,
      shotsPerGame,
      boost: sumBoost("all"),
      threeBoost: zones.filter((spotZone) => threePointZones.has(spotZone.zone)).reduce((runningTotal, spotZone) => runningTotal + spotZone.perGame * spotZone.leak, 0),
      insideBoost: sumBoost("inside"),
      zones,
    });
  }
  const defenses: DefenseLeak[] = [];
  for (const matchup of matchups) {
    const defenseZones = rates.get(matchup.teamId);
    if (!defenseZones) continue;
    const attackersFor = (zone: ShotZoneKey) =>
      players
        .filter((spot) => spot.teamId === matchup.opponentId)
        .map((spot) => ({ playerId: spot.playerId, name: spot.name, perGame: spot.zones.find((spotZone) => spotZone.zone === zone)?.perGame ?? 0 }))
        .filter((attacker) => attacker.perGame >= 0.8)
        .sort((first, second) => second.perGame - first.perGame)
        .slice(0, 2);
    const leaks = [...defenseZones.entries()]
      .map(([zone, entry]) => ({ zone, rate: entry.rate, leak: entry.rate - (data.league.get(zone) ?? entry.rate), rank: entry.rank }))
      .sort((first, second) => second.leak - first.leak)
      .slice(0, 2)
      .map((leakZone) => ({ ...leakZone, attackers: attackersFor(leakZone.zone) }));
    defenses.push({ teamId: matchup.teamId, opponentId: matchup.opponentId, gameId: matchup.gameId, zones: leaks });
  }
  defenses.sort((first, second) => (second.zones[0]?.leak ?? 0) - (first.zones[0]?.leak ?? 0));
  return { players, defenses };
}
