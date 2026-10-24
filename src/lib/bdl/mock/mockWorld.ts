import { SeededRandom } from "./seededRandom";
import { bdlTeam, teamReferences } from "@/lib/nba/teams";
import { addDays, dateRange, todayEastern } from "@/lib/dates";
import { probabilityToAmerican } from "@/lib/math/odds";
import type {
  BdlAdvancedStatsV2,
  BdlBettingOdd,
  BdlBoxScore,
  BdlDeeplinks,
  BdlGame,
  BdlLineup,
  BdlPlay,
  BdlPlayer,
  BdlPlayerInjury,
  BdlPlayerProp,
  BdlStatLine,
  BdlStats,
  CompetitionStatusState,
} from "@/lib/bdl/types";

export const mockSeasonRanges: Record<number, [string, string]> = {
  2025: ["2025-10-21", "2026-04-12"],
  2026: ["2026-10-20", "2027-04-11"],
};

const firstNames = ["Jalen", "Marcus", "Tyrese", "Devin", "Andre", "Malik", "Cole", "Isaiah", "Darius", "Evan", "Julian", "Terrence", "Nolan", "Keegan", "Bryce", "Caleb", "Dorian", "Grant", "Miles", "Quentin", "Rashad", "Simon", "Trey", "Victor", "Wesley", "Xavier", "Zion", "Aaron", "Brandon", "Corey"];
const lastNames = ["Walker", "Bennett", "Harper", "Coleman", "Reyes", "Foster", "Grayson", "Holloway", "Ingram", "Jennings", "Kendrick", "Lawson", "Mercer", "Nash", "Okafor", "Prescott", "Quinlan", "Ramsey", "Sutton", "Thornton", "Underwood", "Vaughn", "Whitaker", "Yates", "Ziegler", "Abbott", "Barlow", "Crowder", "Dalton", "Ellison"];
const rosterPositions = ["G", "G", "F", "F", "C", "G", "F", "F-C", "G-F", "C", "G", "F", "C"];
const lineupPositions = ["PG", "SG", "SF", "PF", "C"];
const slotMinutes = [35, 33, 32, 30, 28, 24, 21, 17, 14, 4, 2, 0, 0];
export const mockGameVendors = ["draftkings", "fanduel", "betmgm", "caesars", "betrivers"];
export const mockPropVendors = ["draftkings", "fanduel", "betrivers", "caesars"];

export interface MockPlayerProfile {
  player: BdlPlayer;
  teamId: number;
  slotIndex: number;
  baseMinutes: number;
  fgaPerMinute: number;
  threeShare: number;
  ftaPerMinute: number;
  orebPerMinute: number;
  drebPerMinute: number;
  astPerMinute: number;
  stlPerMinute: number;
  blkPerMinute: number;
  tovPerMinute: number;
}

export interface MockGameState {
  game: BdlGame;
  completedPeriods: number;
  partialPeriodFraction: number;
}

export type PeriodLine = BdlStatLine & { minutesValue: number };

const profileCache = new Map<number, MockPlayerProfile[]>();
const gameListCache = new Map<string, BdlGame[]>();
const periodLineCache = new Map<number, Map<number, PeriodLine[]>>();

export function mockToday(): string {
  return todayEastern();
}

export function teamStrength(teamId: number): number {
  return new SeededRandom(`strength-${teamId}`).between(-6, 6); // points better than average per game
}

export function teamProfiles(teamId: number): MockPlayerProfile[] {
  const cached = profileCache.get(teamId);
  if (cached) return cached;
  const team = bdlTeam(teamId);
  const profiles = rosterPositions.map((rosterPosition, slotIndex) => {
    const random = new SeededRandom(`player-${teamId}-${slotIndex}`);
    const isBig = rosterPosition.startsWith("C") || rosterPosition.includes("C");
    const isGuard = rosterPosition.startsWith("G");
    const starPower = slotIndex === 0 ? 1.35 : slotIndex === 1 ? 1.15 : 1;
    const player: BdlPlayer = {
      id: teamId * 100 + slotIndex,
      first_name: firstNames[(teamId * 7 + slotIndex * 3) % firstNames.length],
      last_name: lastNames[(teamId * 11 + slotIndex * 5) % lastNames.length],
      position: rosterPosition,
      height: isBig ? "6-11" : isGuard ? "6-3" : "6-7",
      weight: isBig ? "250" : isGuard ? "195" : "220",
      jersey_number: String((slotIndex * 7 + teamId) % 45),
      college: "Mock University",
      country: "USA",
      draft_year: 2016 + (slotIndex % 9),
      draft_round: 1,
      draft_number: 1 + ((teamId + slotIndex) % 30),
      team,
    };
    return {
      player,
      teamId,
      slotIndex,
      baseMinutes: slotMinutes[slotIndex],
      fgaPerMinute: random.between(0.29, 0.38) * starPower,
      threeShare: isBig ? random.between(0.05, 0.25) : random.between(0.35, 0.55),
      ftaPerMinute: random.between(0.07, 0.14) * starPower,
      orebPerMinute: isBig ? random.between(0.08, 0.12) : random.between(0.02, 0.04),
      drebPerMinute: isBig ? random.between(0.2, 0.28) : random.between(0.08, 0.14),
      astPerMinute: isGuard ? random.between(0.17, 0.27) * starPower : random.between(0.05, 0.1),
      stlPerMinute: random.between(0.02, 0.04),
      blkPerMinute: isBig ? random.between(0.04, 0.07) : random.between(0.005, 0.015),
      tovPerMinute: random.between(0.03, 0.06),
    };
  });
  profileCache.set(teamId, profiles);
  return profiles;
}

export function allMockPlayers(): BdlPlayer[] {
  return teamReferences.flatMap((team) => teamProfiles(team.id).map((profile) => profile.player));
}

export function mockPlayerById(playerId: number): BdlPlayer | undefined {
  const teamId = Math.floor(playerId / 100);
  return teamProfiles(teamId).find((profile) => profile.player.id === playerId)?.player;
}

export interface MockInjury {
  playerId: number;
  status: "Out" | "Questionable" | "Day-To-Day" | "Doubtful";
  description: string;
  outSinceDaysAgo: number;
}

export function mockInjuries(): MockInjury[] {
  const todaysGames = mockGamesForDate(mockToday());
  const injuryList: MockInjury[] = [];
  todaysGames.forEach((game, gameIndex) => {
    injuryList.push({ playerId: game.home_team.id * 100 + (gameIndex % 2 === 0 ? 1 : 2), status: "Out", description: "Ankle sprain", outSinceDaysAgo: 8 });
    injuryList.push({ playerId: game.visitor_team.id * 100 + 3, status: gameIndex % 2 === 0 ? "Questionable" : "Day-To-Day", description: "Knee soreness", outSinceDaysAgo: 0 });
  });
  return injuryList;
}

export function isPlayerOut(playerId: number, isoDate: string): boolean {
  const today = mockToday();
  return mockInjuries().some((injury) => injury.playerId === playerId && injury.status === "Out" && isoDate >= addDays(today, -injury.outSinceDaysAgo) && isoDate <= today);
}

function mockDateForGameId(gameId: number): string {
  const digits = String(Math.floor(gameId / 100)).padStart(6, "0"); // id = yymmdd * 100 + index
  return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
}

function inMockSeason(isoDate: string): number | null {
  for (const [seasonText, [startDate, endDate]] of Object.entries(mockSeasonRanges)) if (isoDate >= startDate && isoDate <= endDate) return Number(seasonText);
  return null;
}

function seasonOfMockDate(isoDate: string): number {
  const inSeason = inMockSeason(isoDate);
  if (inSeason !== null) return inSeason;
  const [yearText, monthText] = isoDate.split("-");
  return Number(monthText) >= 8 ? Number(yearText) : Number(yearText) - 1;
}

export function mockGamesForDate(isoDate: string): BdlGame[] {
  const cached = gameListCache.get(isoDate);
  if (cached) return cached;
  const today = mockToday();
  const isToday = isoDate === today;
  if (!isToday && inMockSeason(isoDate) === null) {
    gameListCache.set(isoDate, []);
    return [];
  }
  const random = new SeededRandom(`games-${isoDate}`);
  const gameCount = isToday ? 6 : random.integerBetween(3, 8);
  const shuffledTeams = random.shuffle(teamReferences.map((team) => team.id));
  const games: BdlGame[] = [];
  for (let gameIndex = 0; gameIndex < gameCount; gameIndex++) {
    const homeTeamId = shuffledTeams[gameIndex * 2];
    const visitorTeamId = shuffledTeams[gameIndex * 2 + 1];
    const gameId = Number(isoDate.slice(2).replace(/-/g, "")) * 100 + gameIndex;
    const tipoff = new Date(`${isoDate}T23:00:00Z`);
    tipoff.setUTCMinutes(tipoff.getUTCMinutes() + 30 * gameIndex);
    games.push({
      id: gameId,
      date: isoDate,
      season: seasonOfMockDate(isoDate),
      status: tipoff.toISOString(),
      status_state: "scheduled",
      period: 0,
      time: null,
      period_detail: null,
      datetime: tipoff.toISOString(),
      postseason: false,
      home_team_score: 0,
      visitor_team_score: 0,
      home_team: bdlTeam(homeTeamId),
      visitor_team: bdlTeam(visitorTeamId),
      ist_stage: null,
    });
  }
  gameListCache.set(isoDate, games); // cache before scoring so box score generation can look the game up
  for (const game of games) applyGameState(game, isoDate, today);
  return games;
}

function setStatus(game: BdlGame, status: string, statusState: CompetitionStatusState, period: number, clock: string | null): void {
  game.status = status;
  game.status_state = statusState;
  game.period = period;
  game.time = clock;
  game.period_detail = status;
}

function applyGameState(game: BdlGame, isoDate: string, today: string): void {
  const gameIndex = game.id % 100;
  if (isoDate < today) setStatus(game, "Final", "final", 4, "Final");
  else if (isoDate === today && gameIndex === 0) setStatus(game, "3rd Qtr", "in_progress", 3, "5:42");
  else if (isoDate === today && gameIndex === 1) setStatus(game, "Halftime", "in_progress", 2, "Halftime");
  else if (isoDate === today && gameIndex === 2) setStatus(game, "2nd Qtr", "in_progress", 2, "3:10");
  if (game.status_state === "scheduled") return;
  const scoreLines = mockPeriodLines(game.id);
  let homeScore = 0;
  let visitorScore = 0;
  for (const [playerId, periodLines] of scoreLines) {
    const pointsTotal = periodLines.reduce((runningTotal, periodLine) => runningTotal + (periodLine.pts ?? 0), 0);
    if (Math.floor(playerId / 100) === game.home_team.id) homeScore += pointsTotal;
    else visitorScore += pointsTotal;
  }
  game.home_team_score = homeScore;
  game.visitor_team_score = visitorScore;
}

export function mockGameById(gameId: number): BdlGame | undefined {
  return mockGamesForDate(mockDateForGameId(gameId)).find((game) => game.id === gameId);
}

export function gameProgress(game: BdlGame): MockGameState {
  if (game.status_state === "final") return { game, completedPeriods: 4, partialPeriodFraction: 0 };
  if (game.status_state !== "in_progress") return { game, completedPeriods: 0, partialPeriodFraction: 0 };
  if (game.status === "Halftime") return { game, completedPeriods: 2, partialPeriodFraction: 0 };
  const [clockMinutes, clockSeconds] = (game.time ?? "12:00").split(":").map(Number);
  const remainingFraction = (clockMinutes * 60 + clockSeconds) / 720;
  return { game, completedPeriods: (game.period ?? 1) - 1, partialPeriodFraction: 1 - remainingFraction };
}

function zeroLine(): PeriodLine {
  return { min: "0:00", minutesValue: 0, fgm: 0, fga: 0, fg_pct: 0, fg3m: 0, fg3a: 0, fg3_pct: 0, ftm: 0, fta: 0, ft_pct: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, turnover: 0, pf: 0, pts: 0, plus_minus: 0 };
}

function formatMinutes(minutesValue: number): string {
  const wholeMinutes = Math.floor(minutesValue);
  const seconds = Math.round((minutesValue - wholeMinutes) * 60);
  return seconds === 60 ? `${wholeMinutes + 1}:00` : `${wholeMinutes}:${String(seconds).padStart(2, "0")}`;
}

function percentage(madeCount: number, attemptCount: number): number {
  return attemptCount > 0 ? Math.round((madeCount / attemptCount) * 1000) / 1000 : 0;
}

function teamRotation(teamId: number, isoDate: string): Array<{ profile: MockPlayerProfile; minutes: number }> {
  const profiles = teamProfiles(teamId);
  let freedMinutes = 0;
  const rotation = profiles.map((profile) => {
    const out = isPlayerOut(profile.player.id, isoDate);
    if (out) freedMinutes += profile.baseMinutes;
    return { profile, minutes: out ? 0 : profile.baseMinutes };
  });
  const healthyRotation = rotation.filter((entry) => entry.minutes > 0);
  const healthyTotal = healthyRotation.reduce((runningTotal, entry) => runningTotal + entry.minutes, 0);
  for (const entry of healthyRotation) entry.minutes = Math.min(40, entry.minutes + (freedMinutes * entry.minutes) / healthyTotal); // injured minutes go to teammates
  return rotation;
}

export function mockPeriodLines(gameId: number): Map<number, PeriodLine[]> {
  const cached = periodLineCache.get(gameId);
  if (cached) return cached;
  const isoDate = mockDateForGameId(gameId);
  const gameIndex = gameId % 100;
  const today = mockToday();
  const status = isoDate < today ? "final" : isoDate === today && gameIndex <= 2 ? "live" : "scheduled";
  const linesByPlayer = new Map<number, PeriodLine[]>();
  if (status === "scheduled") {
    periodLineCache.set(gameId, linesByPlayer);
    return linesByPlayer;
  }
  const games = mockGamesForDate(isoDate);
  const game = games.find((candidate) => candidate.id === gameId);
  if (!game) return linesByPlayer;
  const progress = status === "final" ? { completedPeriods: 4, partialPeriodFraction: 0 } : gameIndex === 0 ? { completedPeriods: 2, partialPeriodFraction: 1 - 342 / 720 } : gameIndex === 1 ? { completedPeriods: 2, partialPeriodFraction: 0 } : { completedPeriods: 1, partialPeriodFraction: 1 - 190 / 720 };
  const random = new SeededRandom(`box-${gameId}`);
  for (const teamId of [game.home_team.id, game.visitor_team.id]) {
    const opponentId = teamId === game.home_team.id ? game.visitor_team.id : game.home_team.id;
    const offenseFactor = 1 + (teamStrength(teamId) - teamStrength(opponentId) * 0.5) / 110;
    for (const { profile, minutes } of teamRotation(teamId, isoDate)) {
      const periodLines: PeriodLine[] = [];
      for (let periodNumber = 1; periodNumber <= 4; periodNumber++) {
        const periodFraction = periodNumber <= progress.completedPeriods ? 1 : periodNumber === progress.completedPeriods + 1 ? progress.partialPeriodFraction : 0;
        const periodMinutes = Math.min(12, (minutes / 4) * random.between(0.7, 1.3)) * periodFraction;
        if (periodFraction === 0) break;
        const line = zeroLine();
        if (periodMinutes > 0) {
          const fieldGoalAttempts = random.poisson(periodMinutes * profile.fgaPerMinute * offenseFactor);
          const threeAttempts = random.binomial(fieldGoalAttempts, profile.threeShare);
          const twoMakes = random.binomial(fieldGoalAttempts - threeAttempts, 0.53);
          const threeMakes = random.binomial(threeAttempts, 0.36);
          const freeThrowAttempts = random.poisson(periodMinutes * profile.ftaPerMinute);
          const freeThrowMakes = random.binomial(freeThrowAttempts, 0.79);
          line.minutesValue = periodMinutes;
          line.min = formatMinutes(periodMinutes);
          line.fga = fieldGoalAttempts;
          line.fgm = twoMakes + threeMakes;
          line.fg3a = threeAttempts;
          line.fg3m = threeMakes;
          line.fta = freeThrowAttempts;
          line.ftm = freeThrowMakes;
          line.fg_pct = percentage(line.fgm, line.fga);
          line.fg3_pct = percentage(threeMakes, threeAttempts);
          line.ft_pct = percentage(freeThrowMakes, freeThrowAttempts);
          line.oreb = random.poisson(periodMinutes * profile.orebPerMinute);
          line.dreb = random.poisson(periodMinutes * profile.drebPerMinute);
          line.reb = line.oreb + line.dreb;
          line.ast = random.poisson(periodMinutes * profile.astPerMinute);
          line.stl = random.poisson(periodMinutes * profile.stlPerMinute);
          line.blk = random.poisson(periodMinutes * profile.blkPerMinute);
          line.turnover = random.poisson(periodMinutes * profile.tovPerMinute);
          line.pf = random.poisson(periodMinutes * 0.075);
          line.pts = twoMakes * 2 + threeMakes * 3 + freeThrowMakes;
        }
        periodLines.push(line);
      }
      linesByPlayer.set(profile.player.id, periodLines);
    }
  }
  periodLineCache.set(gameId, linesByPlayer);
  return linesByPlayer;
}

export function sumPeriodLines(periodLines: PeriodLine[]): PeriodLine {
  const total = zeroLine();
  const countingFields = ["fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "turnover", "pf", "pts"] as const;
  for (const periodLine of periodLines) {
    total.minutesValue += periodLine.minutesValue;
    for (const fieldName of countingFields) total[fieldName] = (total[fieldName] ?? 0) + (periodLine[fieldName] ?? 0);
  }
  total.min = formatMinutes(total.minutesValue);
  total.fg_pct = percentage(total.fgm ?? 0, total.fga ?? 0);
  total.fg3_pct = percentage(total.fg3m ?? 0, total.fg3a ?? 0);
  total.ft_pct = percentage(total.ftm ?? 0, total.fta ?? 0);
  return total;
}

function stripLine(periodLine: PeriodLine): BdlStatLine {
  const { minutesValue: _unusedMinutes, ...statLine } = periodLine;
  return statLine;
}

function teamPointsInPeriods(game: BdlGame, teamId: number, periodNumbers: number[]): number {
  let pointsTotal = 0;
  for (const [playerId, periodLines] of mockPeriodLines(game.id)) {
    if (Math.floor(playerId / 100) !== teamId) continue;
    for (const periodNumber of periodNumbers) pointsTotal += periodLines[periodNumber - 1]?.pts ?? 0;
  }
  return pointsTotal;
}

export function mockStatsForGame(game: BdlGame, periodFilter: number): BdlStats[] {
  const statRows: BdlStats[] = [];
  const periodNumbers = periodFilter === 0 ? [1, 2, 3, 4] : [periodFilter];
  for (const [playerId, periodLines] of mockPeriodLines(game.id)) {
    const player = mockPlayerById(playerId);
    if (!player) continue;
    const teamId = Math.floor(playerId / 100);
    const opponentId = teamId === game.home_team.id ? game.visitor_team.id : game.home_team.id;
    const chosenLines = periodFilter === 0 ? periodLines : periodLines.slice(periodFilter - 1, periodFilter);
    if (chosenLines.length === 0) continue;
    const combined = sumPeriodLines(chosenLines);
    const teamMargin = teamPointsInPeriods(game, teamId, periodNumbers) - teamPointsInPeriods(game, opponentId, periodNumbers);
    combined.plus_minus = Math.round((teamMargin * combined.minutesValue) / (12 * periodNumbers.length)) || 0;
    statRows.push({ id: game.id * 10000 + playerId * 10 + periodFilter, ...stripLine(combined), player, team: bdlTeam(teamId), game });
  }
  return statRows;
}

export function mockBoxScore(game: BdlGame): BdlBoxScore {
  const statRows = mockStatsForGame(game, 0);
  const sideFor = (teamId: number) => ({
    team: bdlTeam(teamId),
    players: statRows.filter((statRow) => statRow.team.id === teamId).map(({ id: _unusedId, team: _unusedTeam, game: _unusedGame, ...boxRow }) => boxRow),
  });
  return {
    date: game.date,
    season: game.season,
    status: game.status ?? "",
    status_state: game.status_state,
    period: game.period ?? 0,
    time: game.time ?? "",
    postseason: game.postseason,
    home_team_score: game.home_team_score,
    visitor_team_score: game.visitor_team_score,
    home_team: sideFor(game.home_team.id),
    visitor_team: sideFor(game.visitor_team.id),
  };
}

export function mockLineups(game: BdlGame): BdlLineup[] {
  const lineupRows: BdlLineup[] = [];
  for (const teamId of [game.home_team.id, game.visitor_team.id]) {
    const rotation = teamRotation(teamId, game.date).filter((entry) => entry.minutes > 0).sort((first, second) => second.minutes - first.minutes);
    rotation.forEach((entry, rotationIndex) => {
      const { team: _unusedTeam, ...playerFields } = entry.profile.player;
      lineupRows.push({
        id: game.id * 100 + teamId + rotationIndex,
        game_id: game.id,
        starter: rotationIndex < 5,
        position: rotationIndex < 5 ? lineupPositions[rotationIndex] : rotationIndex % 2 === 0 ? null : "",
        player: { ...playerFields, team_id: teamId },
        team: bdlTeam(teamId),
      });
    });
  }
  return lineupRows;
}

export function mockPlays(game: BdlGame): BdlPlay[] {
  if (game.status_state !== "final") return [];
  const random = new SeededRandom(`plays-${game.id}`);
  const plays: BdlPlay[] = [];
  let homeScore = 0;
  let awayScore = 0;
  for (let periodNumber = 1; periodNumber <= 4; periodNumber++) {
    const events: Array<{ teamId: number; type: string; text: string; shooting: boolean; scoreValue: number; made: boolean }> = [];
    for (const teamId of [game.home_team.id, game.visitor_team.id]) {
      const periodStats = mockStatsForGame(game, periodNumber).filter((statRow) => statRow.team.id === teamId);
      const teamTotal = (fieldName: keyof BdlStatLine) => periodStats.reduce((runningTotal, statRow) => runningTotal + Number(statRow[fieldName] ?? 0), 0);
      const twoMakes = teamTotal("fgm") - teamTotal("fg3m");
      const twoMisses = teamTotal("fga") - teamTotal("fg3a") - twoMakes;
      for (let eventIndex = 0; eventIndex < twoMakes; eventIndex++) events.push({ teamId, type: "Jump Shot", text: "makes jump shot", shooting: true, scoreValue: 2, made: true });
      for (let eventIndex = 0; eventIndex < twoMisses; eventIndex++) events.push({ teamId, type: "Jump Shot", text: "misses jump shot", shooting: true, scoreValue: 2, made: false });
      for (let eventIndex = 0; eventIndex < teamTotal("fg3m"); eventIndex++) events.push({ teamId, type: "Three Point Jumper", text: "makes three point jumper", shooting: true, scoreValue: 3, made: true });
      for (let eventIndex = 0; eventIndex < teamTotal("fg3a") - teamTotal("fg3m"); eventIndex++) events.push({ teamId, type: "Three Point Jumper", text: "misses three point jumper", shooting: true, scoreValue: 3, made: false });
      for (let eventIndex = 0; eventIndex < teamTotal("ftm"); eventIndex++) events.push({ teamId, type: "Free Throw - 1 of 2", text: "makes free throw", shooting: true, scoreValue: 1, made: true });
      for (let eventIndex = 0; eventIndex < teamTotal("fta") - teamTotal("ftm"); eventIndex++) events.push({ teamId, type: "Free Throw - 2 of 2", text: "misses free throw", shooting: true, scoreValue: 1, made: false });
      for (let eventIndex = 0; eventIndex < teamTotal("oreb"); eventIndex++) events.push({ teamId, type: "Offensive Rebound", text: "offensive rebound", shooting: false, scoreValue: 0, made: false });
      for (let eventIndex = 0; eventIndex < teamTotal("dreb"); eventIndex++) events.push({ teamId, type: "Defensive Rebound", text: "defensive rebound", shooting: false, scoreValue: 0, made: false });
      for (let eventIndex = 0; eventIndex < teamTotal("turnover"); eventIndex++) events.push({ teamId, type: "Lost Ball Turnover", text: "lost ball turnover", shooting: false, scoreValue: 0, made: false });
    }
    const orderedEvents = random.shuffle(events);
    orderedEvents.forEach((event, eventIndex) => {
      if (event.made) {
        if (event.teamId === game.home_team.id) homeScore += event.scoreValue;
        else awayScore += event.scoreValue;
      }
      const secondsLeft = Math.max(0, Math.round(720 - (720 * (eventIndex + 1)) / (orderedEvents.length + 1)));
      plays.push({
        game_id: game.id,
        order: plays.length + 1,
        type: event.type,
        text: event.text,
        home_score: homeScore,
        away_score: awayScore,
        period: periodNumber,
        period_display: `Q${periodNumber}`,
        clock: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`,
        scoring_play: event.made,
        shooting_play: event.shooting,
        score_value: event.made ? event.scoreValue : 0,
        team: bdlTeam(event.teamId),
        participants: [],
      });
    });
    plays.push({ game_id: game.id, order: plays.length + 1, type: "End Period", text: `End of Q${periodNumber}`, home_score: homeScore, away_score: awayScore, period: periodNumber, period_display: `Q${periodNumber}`, clock: "0:00", scoring_play: false, shooting_play: false, score_value: 0, team: null, participants: [] });
  }
  return plays;
}

export function mockAdvancedStats(game: BdlGame, periodFilter: number): BdlAdvancedStatsV2[] {
  const random = new SeededRandom(`advanced-${game.id}-${periodFilter}`);
  return mockStatsForGame(game, periodFilter).map((statRow) => {
    const minutesPlayed = Math.max(0.1, Number((statRow.min ?? "0").split(":")[0]));
    const fieldGoalAttempts = statRow.fga ?? 0;
    const freeThrowAttempts = statRow.fta ?? 0;
    const trueShootingAttempts = 2 * (fieldGoalAttempts + 0.44 * freeThrowAttempts);
    return {
      id: statRow.id,
      period: periodFilter,
      player: statRow.player,
      team: statRow.team,
      game,
      pie: Math.round(random.between(0.02, 0.2) * 1000) / 1000,
      pace: Math.round(random.between(96, 104) * 10) / 10,
      possessions: Math.round(minutesPlayed * 2.1),
      offensive_rating: Math.round(random.between(100, 128) * 10) / 10,
      defensive_rating: Math.round(random.between(102, 122) * 10) / 10,
      net_rating: 0,
      usage_percentage: Math.round(((fieldGoalAttempts + 0.44 * freeThrowAttempts + (statRow.turnover ?? 0)) / Math.max(1, minutesPlayed * 2)) * 1000) / 1000,
      true_shooting_percentage: trueShootingAttempts > 0 ? Math.round(((statRow.pts ?? 0) / trueShootingAttempts) * 1000) / 1000 : 0,
      effective_field_goal_percentage: fieldGoalAttempts > 0 ? Math.round((((statRow.fgm ?? 0) + 0.5 * (statRow.fg3m ?? 0)) / fieldGoalAttempts) * 1000) / 1000 : 0,
      assist_percentage: Math.round(random.between(0.05, 0.35) * 1000) / 1000,
      rebound_percentage: Math.round(random.between(0.04, 0.2) * 1000) / 1000,
      touches: Math.round(minutesPlayed * random.between(1.2, 2.4)),
      speed: Math.round(random.between(3.8, 4.6) * 100) / 100,
      distance: Math.round(minutesPlayed * 0.075 * 100) / 100,
      deflections: random.poisson(minutesPlayed * 0.06),
      contested_shots: random.poisson(minutesPlayed * 0.2),
      matchup_minutes: `${Math.floor(minutesPlayed * 0.7)}:00`,
    };
  });
}

function mockDeeplinks(vendor: string, gameId: number, selectionKeys: string[], includeSelections: boolean): BdlDeeplinks | null {
  if (vendor === "draftkings" && gameId % 3 === 0) return null; // some vendors return no links, like the docs show
  const eventUrl = `https://${vendor}.mock-sportsbook.example/{state}/event/${gameId}`;
  const selections: Record<string, { url: string | null; url_template: string | null }> = {};
  if (includeSelections) {
    for (const selectionKey of selectionKeys) {
      selections[selectionKey] =
        vendor === "betrivers"
          ? { url: null, url_template: `https://{state}.betrivers.mock-sportsbook.example/?page=sportsbook#event/${gameId}?coupon={pickType}|${gameId}${selectionKey.length}|{wagerAmount}` }
          : { url: null, url_template: `${eventUrl}?selection=${selectionKey}-${gameId}` };
    }
  }
  return { event: { url: null, url_template: eventUrl }, selections };
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function americanFromNoise(random: SeededRandom): number {
  return random.integerBetween(-118, -104);
}

export function mockGameOdds(game: BdlGame, opening: boolean): BdlBettingOdd[] {
  const strengthGap = teamStrength(game.home_team.id) - teamStrength(game.visitor_team.id) + 2.5; // home court
  const baseTotal = 226 + (teamStrength(game.home_team.id) + teamStrength(game.visitor_team.id)) * 0.6;
  return mockGameVendors.map((vendor, vendorIndex) => {
    const random = new SeededRandom(`odds-${game.id}-${vendor}-${opening ? "open" : "live"}`);
    const drift = opening ? 0 : random.between(-1.5, 1.5);
    let spreadHome = roundToHalf(-strengthGap + drift + (vendorIndex - 2) * 0.25);
    let totalValue = roundToHalf(baseTotal + drift + random.between(-1, 1));
    if (!opening && game.status_state === "in_progress") {
      const progress = gameProgress(game);
      const elapsedShare = (progress.completedPeriods + progress.partialPeriodFraction) / 4;
      const currentMargin = game.home_team_score - game.visitor_team_score;
      spreadHome = roundToHalf(spreadHome * (1 - elapsedShare) - currentMargin);
      totalValue = roundToHalf(game.home_team_score + game.visitor_team_score + totalValue * (1 - elapsedShare));
    }
    const homeWinChance = 1 / (1 + Math.exp(spreadHome / 6.5));
    const toAmerican = (chance: number) => (chance >= 0.5 ? -Math.round((chance / (1 - chance)) * 100 * 1.04) : Math.round(((1 - chance) / chance) * 100 * 0.96));
    const odd: BdlBettingOdd = {
      id: game.id * 10 + vendorIndex,
      game_id: game.id,
      vendor,
      spread_home_value: String(spreadHome),
      spread_home_odds: americanFromNoise(random),
      spread_away_value: String(-spreadHome),
      spread_away_odds: americanFromNoise(random),
      moneyline_home_odds: toAmerican(homeWinChance),
      moneyline_away_odds: toAmerican(1 - homeWinChance),
      total_value: String(totalValue),
      total_over_odds: americanFromNoise(random),
      total_under_odds: americanFromNoise(random),
      deeplinks: mockDeeplinks(vendor, game.id, ["moneyline_home", "moneyline_away", "spread_home", "spread_away", "total_over", "total_under"], true),
    };
    if (opening) odd.opened_at = `${addDays(game.date, -1)}T15:00:00.000Z`;
    else odd.updated_at = new Date().toISOString();
    return odd;
  });
}

const propDefinitions: Array<{ propType: string; statFields: Array<keyof BdlStatLine>; firstQuarterOnly?: boolean }> = [
  { propType: "points", statFields: ["pts"] },
  { propType: "rebounds", statFields: ["reb"] },
  { propType: "assists", statFields: ["ast"] },
  { propType: "threes", statFields: ["fg3m"] },
  { propType: "steals", statFields: ["stl"] },
  { propType: "blocks", statFields: ["blk"] },
  { propType: "points_rebounds_assists", statFields: ["pts", "reb", "ast"] },
  { propType: "points_rebounds", statFields: ["pts", "reb"] },
  { propType: "points_assists", statFields: ["pts", "ast"] },
  { propType: "rebounds_assists", statFields: ["reb", "ast"] },
  { propType: "points_1q", statFields: ["pts"], firstQuarterOnly: true },
];

function expectedPerMinute(profile: MockPlayerProfile, statField: keyof BdlStatLine): number {
  const pointsPerMinute = profile.fgaPerMinute * ((1 - profile.threeShare) * 0.53 * 2 + profile.threeShare * 0.36 * 3) + profile.ftaPerMinute * 0.79;
  const ratePerMinute: Partial<Record<keyof BdlStatLine, number>> = {
    pts: pointsPerMinute,
    reb: profile.orebPerMinute + profile.drebPerMinute,
    ast: profile.astPerMinute,
    fg3m: profile.fgaPerMinute * profile.threeShare * 0.36,
    stl: profile.stlPerMinute,
    blk: profile.blkPerMinute,
  };
  return ratePerMinute[statField] ?? 0;
}

function recentMockAverage(playerId: number, teamId: number, beforeDate: string, statFields: Array<keyof BdlStatLine>, periodScope: "full" | "first_quarter" | "second_half"): number | null {
  const values: number[] = [];
  for (let dayOffset = 1; dayOffset <= 200 && values.length < 10; dayOffset++) {
    const isoDate = addDays(beforeDate, -dayOffset);
    const game = mockGamesForDate(isoDate).find((candidate) => candidate.home_team.id === teamId || candidate.visitor_team.id === teamId);
    if (!game || game.status_state !== "final") continue;
    const periodLines = mockPeriodLines(game.id).get(playerId);
    if (!periodLines || periodLines.every((periodLine) => periodLine.minutesValue === 0)) continue;
    const scoped = periodScope === "first_quarter" ? periodLines.slice(0, 1) : periodScope === "second_half" ? periodLines.slice(2, 4) : periodLines;
    const combined = sumPeriodLines(scoped);
    values.push(statFields.reduce((runningTotal, statField) => runningTotal + Number(combined[statField] ?? 0), 0));
  }
  return values.length > 0 ? values.reduce((runningTotal, value) => runningTotal + value, 0) / values.length : null; // books set lines near recent form
}

export function mockPlayerProps(game: BdlGame, opening: boolean, playerFilter?: number, propTypeFilter?: string): BdlPlayerProp[] {
  if (!opening && game.status_state === "final") return []; // books pull props as games finish
  const props: BdlPlayerProp[] = [];
  const liveLines = game.status_state === "in_progress" ? mockPeriodLines(game.id) : null;
  const progress = gameProgress(game);
  const elapsedShare = (progress.completedPeriods + progress.partialPeriodFraction) / 4;
  for (const teamId of [game.home_team.id, game.visitor_team.id]) {
    for (const { profile, minutes } of teamRotation(teamId, game.date)) {
      if (minutes < 18) continue;
      if (playerFilter && profile.player.id !== playerFilter) continue;
      for (const definition of propDefinitions) {
        if (propTypeFilter && definition.propType !== propTypeFilter) continue;
        if (definition.firstQuarterOnly && !opening && elapsedShare > 0) continue;
        const minutesScope = definition.firstQuarterOnly ? minutes / 4 : minutes;
        const formulaValue = definition.statFields.reduce((runningTotal, statField) => runningTotal + expectedPerMinute(profile, statField) * minutesScope, 0);
        let expectedValue = recentMockAverage(profile.player.id, teamId, game.date, definition.statFields, definition.firstQuarterOnly ? "first_quarter" : "full") ?? formulaValue;
        if (!opening && liveLines && !definition.firstQuarterOnly) {
          const soFar = sumPeriodLines(liveLines.get(profile.player.id) ?? []);
          const actualSoFar = definition.statFields.reduce((runningTotal, statField) => runningTotal + Number(soFar[statField] ?? 0), 0);
          const secondHalfAverage = game.status === "Halftime" ? recentMockAverage(profile.player.id, teamId, game.date, definition.statFields, "second_half") : null;
          expectedValue = actualSoFar + (secondHalfAverage ?? expectedValue * (1 - elapsedShare)); // live books re-center on the score so far
        }
        if (expectedValue < 0.6) continue;
        mockPropVendors.forEach((vendor, vendorIndex) => {
          const random = new SeededRandom(`prop-${game.id}-${profile.player.id}-${definition.propType}-${vendor}-${opening ? "open" : "live"}`);
          const lineValue = Math.max(0.5, Math.floor(expectedValue + random.between(-0.6, 0.6)) + 0.5);
          const overChance = random.between(0.44, 0.58);
          const overOdds = probabilityToAmerican(overChance * 1.022); // about 4.5% total vig split across both sides
          const underOdds = probabilityToAmerican((1 - overChance) * 1.022);
          const linksProvided = vendor === "betrivers" || vendor === "caesars"; // docs: prop deeplinks come from some books only
          const prop: BdlPlayerProp = {
            id: game.id * 1000 + profile.player.id * 10 + vendorIndex,
            game_id: game.id,
            player_id: profile.player.id,
            vendor,
            prop_type: definition.propType,
            line_value: String(lineValue),
            market: { type: "over_under", over_odds: overOdds, under_odds: underOdds },
            deeplinks: linksProvided ? mockDeeplinks(vendor, game.id, ["over", "under"], true) : null,
          };
          if (opening) prop.opened_at = `${addDays(game.date, -1)}T16:00:00.000Z`;
          else prop.updated_at = new Date().toISOString();
          props.push(prop);
        });
      }
    }
  }
  return props;
}

export function mockInjuryRows(): BdlPlayerInjury[] {
  const today = mockToday();
  return mockInjuries().flatMap((injury) => {
    const player = mockPlayerById(injury.playerId);
    if (!player) return [];
    return [{ player, status: injury.status, description: injury.description, return_date: injury.status === "Out" ? addDays(today, 5) : today }];
  });
}

export function mockGamesInRange(startDate: string, endDate: string): BdlGame[] {
  return dateRange(startDate, endDate).flatMap((isoDate) => mockGamesForDate(isoDate));
}
