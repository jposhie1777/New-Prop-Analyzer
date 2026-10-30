import { ncaabGameDate, type NcaabGame, type NcaabPlay } from "./types";

export interface ShootingLine {
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threesMade: number;
  threesAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  turnovers: number;
  steals: number;
  blocks: number;
  fouls: number;
}

export interface TeamBox extends ShootingLine {
  teamId: number;
  possessions: number;
}

export interface PlayerBox extends ShootingLine {
  name: string;
  teamId: number;
  playerId: number | null; // matched to the roster by name when possible
}

export interface GameBox {
  gameId: number;
  date: string;
  season: number;
  homeTeamId: number;
  awayTeamId: number;
  home: TeamBox;
  away: TeamBox;
  possessions: number; // average of the two sides
  players: PlayerBox[];
  quality: { pointsMatch: boolean; homePlayerPoints: number; awayPlayerPoints: number; unparsedPlays: number; totalPlays: number };
}

function emptyLine(): ShootingLine {
  return { points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threesMade: 0, threesAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, turnovers: 0, steals: 0, blocks: 0, fouls: 0 };
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTeamName(name: string): boolean {
  return /\bteam\b|deadball/i.test(name); // "Duke Team Rebound", "Deadball Team Rebound"
}

const shotPattern = /^(.+?)\s+(made|missed)\s+(.+?)(?:\.\s*(.*))?$/i;
const reboundPattern = /^(.+?)\s+(offensive|defensive)\s+(?:team\s+)?rebound/i; // "Duke Offensive Team Rebound" too
const turnoverPattern = /^(.+?)\s+turnover/i;
const stealPattern = /^(.+?)\s+steal/i;
const blockPattern = /^(.+?)\s+block/i;
const foulOnPattern = /^foul on\s+(.+?)\.?$/i;
const foulByPattern = /^(.+?)\s+(?:personal|shooting|offensive|technical|flagrant)?\s*foul/i;
const assistPattern = /assisted by\s+(.+?)\.?$/i;

export function buildGameBox(game: NcaabGame, plays: NcaabPlay[], rosterIds: Map<string, number> = new Map()): GameBox {
  const homeTeamId = game.home_team.id;
  const awayTeamId = game.visitor_team.id;
  const teamLines = new Map<number, ShootingLine>([
    [homeTeamId, emptyLine()],
    [awayTeamId, emptyLine()],
  ]);
  const teamNameKeys = new Set([game.home_team, game.visitor_team].flatMap((team) => [team.college, team.full_name, team.name, team.abbreviation].filter(Boolean).map(normalizeName)));
  const isTeamLabel = (name: string) => isTeamName(name) || teamNameKeys.has(normalizeName(name)); // "Michigan Offensive Rebound." is a team rebound
  const playerLines = new Map<string, PlayerBox>();
  const playerLine = (rawName: string, teamId: number): PlayerBox => {
    const name = rawName.trim();
    const key = `${teamId}|${normalizeName(name)}`;
    let line = playerLines.get(key);
    if (!line) {
      line = { ...emptyLine(), name, teamId, playerId: rosterIds.get(`${teamId}|${normalizeName(name)}`) ?? rosterIds.get(normalizeName(name)) ?? null };
      playerLines.set(key, line);
    }
    return line;
  };
  let unparsedPlays = 0;
  let previousHome = 0;
  let previousAway = 0;
  const ordered = [...plays].sort((first, second) => first.order - second.order);
  for (const play of ordered) {
    const text = (play.text ?? "").trim();
    const homeScore = play.home_score ?? previousHome;
    const awayScore = play.away_score ?? previousAway;
    const scoredTeam = homeScore > previousHome ? homeTeamId : awayScore > previousAway ? awayTeamId : null; // who the score moved for
    previousHome = homeScore;
    previousAway = awayScore;
    const teamId = play.team?.id === homeTeamId || play.team?.id === awayTeamId ? play.team.id : scoredTeam;
    if (!text) continue;
    const shot = text.match(shotPattern);
    if (shot && teamId !== null) {
      const [, shooter, result, description, rest] = shot;
      const made = result.toLowerCase() === "made";
      const freeThrow = /free throw/i.test(description);
      const three = !freeThrow && (/three|3-pt|3pt/i.test(description) || play.score_value === 3);
      const value = freeThrow ? 1 : three ? 3 : 2;
      const team = teamLines.get(teamId)!;
      const player = isTeamLabel(shooter) ? null : playerLine(shooter, teamId);
      for (const line of player ? [team, player] : [team]) {
        if (freeThrow) {
          line.freeThrowsAttempted += 1;
          if (made) line.freeThrowsMade += 1;
        } else {
          line.fieldGoalsAttempted += 1;
          if (three) line.threesAttempted += 1;
          if (made) {
            line.fieldGoalsMade += 1;
            if (three) line.threesMade += 1;
          }
        }
        if (made) line.points += value;
      }
      const assist = (rest ?? "").match(assistPattern) ?? text.match(assistPattern);
      if (made && assist) {
        team.assists += 1;
        playerLine(assist[1], teamId).assists += 1;
      }
      continue;
    }
    const rebound = text.match(reboundPattern);
    if (rebound && teamId !== null) {
      const offensive = rebound[2].toLowerCase() === "offensive";
      const team = teamLines.get(teamId)!;
      if (offensive) team.offensiveRebounds += 1;
      else team.defensiveRebounds += 1;
      if (!isTeamLabel(rebound[1]) && !/team rebound/i.test(text)) {
        const player = playerLine(rebound[1], teamId);
        if (offensive) player.offensiveRebounds += 1;
        else player.defensiveRebounds += 1;
      }
      continue;
    }
    const turnover = text.match(turnoverPattern);
    if (turnover && teamId !== null) {
      teamLines.get(teamId)!.turnovers += 1;
      if (!isTeamLabel(turnover[1])) playerLine(turnover[1], teamId).turnovers += 1;
      continue;
    }
    const steal = text.match(stealPattern);
    if (steal && teamId !== null) {
      teamLines.get(teamId)!.steals += 1;
      if (!isTeamLabel(steal[1])) playerLine(steal[1], teamId).steals += 1;
      continue;
    }
    const block = text.match(blockPattern);
    if (block && teamId !== null) {
      teamLines.get(teamId)!.blocks += 1;
      if (!isTeamLabel(block[1])) playerLine(block[1], teamId).blocks += 1;
      continue;
    }
    const foul = text.match(foulOnPattern) ?? text.match(foulByPattern);
    if (foul && teamId !== null) {
      teamLines.get(teamId)!.fouls += 1;
      if (!isTeamLabel(foul[1])) playerLine(foul[1], teamId).fouls += 1;
      continue;
    }
    if (!/timeout|jump ball|end of|start of|enters the game|subbing|substitution|official|review/i.test(text)) unparsedPlays += 1; // anything else the parser skipped
  }
  const possessionsOf = (line: ShootingLine) => line.fieldGoalsAttempted - line.offensiveRebounds + line.turnovers + 0.475 * line.freeThrowsAttempted;
  const home: TeamBox = { ...teamLines.get(homeTeamId)!, teamId: homeTeamId, possessions: possessionsOf(teamLines.get(homeTeamId)!) };
  const away: TeamBox = { ...teamLines.get(awayTeamId)!, teamId: awayTeamId, possessions: possessionsOf(teamLines.get(awayTeamId)!) };
  const players = [...playerLines.values()].sort((first, second) => first.teamId - second.teamId || second.points - first.points);
  const homePlayerPoints = players.filter((line) => line.teamId === homeTeamId).reduce((runningTotal, line) => runningTotal + line.points, 0);
  const awayPlayerPoints = players.filter((line) => line.teamId === awayTeamId).reduce((runningTotal, line) => runningTotal + line.points, 0);
  return {
    gameId: game.id,
    date: ncaabGameDate(game),
    season: game.season,
    homeTeamId,
    awayTeamId,
    home,
    away,
    possessions: (home.possessions + away.possessions) / 2,
    players,
    quality: { pointsMatch: home.points === (game.home_score ?? -1) && away.points === (game.away_score ?? -1), homePlayerPoints, awayPlayerPoints, unparsedPlays, totalPlays: plays.length },
  };
}

export function otherTeamOf(box: GameBox, teamId: number): TeamBox {
  return box.homeTeamId === teamId ? box.away : box.home;
}
