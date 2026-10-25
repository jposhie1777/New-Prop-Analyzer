import type { BdlBettingOdd, BdlBoxScorePlayer, BdlPlay, BdlShotChartRow } from "@/lib/bdl/types";
import type { QuarterProfile } from "./aggregates/playerAggregates";
import type { GameClock } from "./liveProjection";
import { median } from "@/lib/odds/consensus";

export type ShotZone = "rim" | "short" | "mid" | "long" | "three";

export const shotZones: ShotZone[] = ["rim", "short", "mid", "long", "three"];
export const leagueZoneRates: Record<ShotZone, number> = { rim: 0.66, short: 0.44, mid: 0.42, long: 0.4, three: 0.36 }; // rough league make rates by distance
export const leagueTwoPointRate = 0.53;
export const leagueFreeThrowRate = 0.78;
const zonePriorShots = 15; // a player's zone rate needs about this many shots before it outweighs the league rate
const inactiveAfterSubMinutes = 10; // subbed out this long with no return looks like more than a rest
const inactiveSilentMinutes = 12; // no plays at all for this long

export interface ShotProfile {
  zoneRates: Record<ShotZone, number>;
  zoneAttempts: Record<ShotZone, number>;
  shots: number;
}

export interface ParsedShot {
  playerId: number;
  zone: ShotZone;
  value: 2 | 3;
  made: boolean;
}

export interface PlayerActivity {
  lastSeenElapsed: number | null; // game seconds elapsed at the player's last play
  lastSeenLabel: string | null;
  subbedOut: boolean;
  foulTimes: string[];
  shots: ParsedShot[];
}

export interface ShootingCheck {
  expectedPoints: number;
  actualPoints: number;
  luck: number; // actual minus expected: positive means a hot, likely-to-cool half
  threesExpected: number;
  threesMade: number;
  source: "play-by-play" | "box score";
}

export interface MarketRead {
  liveTotal: number;
  liveSpreadHome: number | null;
  paceFactor: number | null; // books' expected scoring for the time left vs. the pregame total
  expectedFinalMarginHome: number | null;
  books: number;
}

export function zoneForShot(distanceFeet: number | null, shotValue: number, shotDescription: string): ShotZone {
  if (shotValue === 3 || /three point|3pt/i.test(shotDescription)) return "three";
  if (/layup|dunk|tip|alley|putback|finger roll/i.test(shotDescription) || (distanceFeet !== null && distanceFeet <= 3)) return "rim";
  if (distanceFeet === null) return "mid";
  if (distanceFeet <= 9) return "short";
  if (distanceFeet <= 16) return "mid";
  return "long";
}

export function buildShotProfiles(shots: BdlShotChartRow[]): Map<number, ShotProfile> {
  const tallies = new Map<number, Record<ShotZone, { made: number; attempts: number }>>();
  for (const shot of shots) {
    const zone = zoneForShot(shot.shot_distance, shot.shot_value, `${shot.shot_type ?? ""} ${shot.shot_zone_basic ?? ""}`);
    const playerTally = tallies.get(shot.player_id) ?? (Object.fromEntries(shotZones.map((zoneName) => [zoneName, { made: 0, attempts: 0 }])) as Record<ShotZone, { made: number; attempts: number }>);
    playerTally[zone].attempts += 1;
    if (shot.made) playerTally[zone].made += 1;
    tallies.set(shot.player_id, playerTally);
  }
  const profiles = new Map<number, ShotProfile>();
  for (const [playerId, playerTally] of tallies) {
    const zoneRates = {} as Record<ShotZone, number>;
    const zoneAttempts = {} as Record<ShotZone, number>;
    for (const zone of shotZones) {
      zoneRates[zone] = (playerTally[zone].made + zonePriorShots * leagueZoneRates[zone]) / (playerTally[zone].attempts + zonePriorShots); // shrink toward the league rate
      zoneAttempts[zone] = playerTally[zone].attempts;
    }
    profiles.set(playerId, { zoneRates, zoneAttempts, shots: shotZones.reduce((runningTotal, zone) => runningTotal + playerTally[zone].attempts, 0) });
  }
  return profiles;
}

export function elapsedSeconds(period: number, clockText: string): number {
  const clockMatch = clockText.match(/(\d{1,2}):(\d{2})/);
  const secondsLeft = clockMatch ? Number(clockMatch[1]) * 60 + Number(clockMatch[2]) : 0;
  if (period <= 4) return (period - 1) * 720 + (720 - Math.min(720, secondsLeft));
  return 2880 + (period - 5) * 300 + (300 - Math.min(300, secondsLeft)); // overtime periods are 5 minutes
}

export function clockElapsed(clock: GameClock): number {
  if (clock.isHalftime) return 1440;
  return clock.period <= 4 ? (clock.period - 1) * 720 + (720 - clock.secondsLeftInPeriod) : 2880 + (clock.period - 5) * 300 + (300 - clock.secondsLeftInPeriod);
}

export function normalizePersonName(rawName: string): string {
  return rawName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // drop accents so "Jokić" matches "Jokic"
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function periodLabel(period: number, clockText: string): string {
  return `${period <= 4 ? `Q${period}` : `OT${period - 4}`} ${clockText}`;
}

export function parseLivePlays(plays: BdlPlay[], players: Array<{ id: number; name: string }>): Map<number, PlayerActivity> {
  const activity = new Map<number, PlayerActivity>(players.map((player) => [player.id, { lastSeenElapsed: null, lastSeenLabel: null, subbedOut: false, foulTimes: [], shots: [] }]));
  const knownIds = new Set(players.map((player) => player.id));
  const nameIndex = players.map((player) => ({ id: player.id, name: normalizePersonName(player.name) })).filter((entry) => entry.name.length > 3).sort((first, second) => second.name.length - first.name.length); // longest names first so "Jalen Williams" beats "Jalen"
  const idForName = (rawName: string) => nameIndex.find((entry) => entry.name === normalizePersonName(rawName))?.id ?? null;
  const markSeen = (playerId: number, elapsed: number, label: string) => {
    const playerActivity = activity.get(playerId);
    if (!playerActivity) return;
    if (playerActivity.lastSeenElapsed === null || elapsed >= playerActivity.lastSeenElapsed) {
      playerActivity.lastSeenElapsed = elapsed;
      playerActivity.lastSeenLabel = label;
    }
  };
  for (const play of [...plays].sort((first, second) => first.order - second.order)) {
    const elapsed = elapsedSeconds(play.period, play.clock);
    const label = periodLabel(play.period, play.clock);
    const playText = play.text ?? "";
    const normalizedText = normalizePersonName(playText);
    const substitution = playText.match(/^(.+?) enters the game for (.+?)\.?$/i);
    if (substitution) {
      const enteringId = idForName(substitution[1]);
      const leavingId = idForName(substitution[2]);
      if (enteringId !== null) {
        markSeen(enteringId, elapsed, label);
        activity.get(enteringId)!.subbedOut = false;
      }
      if (leavingId !== null) {
        markSeen(leavingId, elapsed, label);
        activity.get(leavingId)!.subbedOut = true;
      }
      continue;
    }
    const participantIds = (play.participants ?? []).filter((participantId) => knownIds.has(participantId));
    const namedIds = nameIndex.filter((entry) => normalizedText.includes(entry.name)).map((entry) => entry.id);
    const involvedIds = [...new Set([...participantIds, ...namedIds])];
    for (const playerId of involvedIds) markSeen(playerId, elapsed, label);
    const actorId = participantIds[0] ?? nameIndex.find((entry) => normalizedText.startsWith(entry.name))?.id ?? null; // the shooter or fouler comes first
    if (actorId === null) continue;
    const actor = activity.get(actorId)!;
    if (/foul/i.test(`${play.type} ${playText}`) && !/foul drawn|technical/i.test(playText) && normalizedText.startsWith(nameIndex.find((entry) => entry.id === actorId)?.name ?? "\u0000")) actor.foulTimes.push(label);
    if (play.shooting_play && !/free throw/i.test(`${play.type} ${playText}`)) {
      const distanceMatch = playText.match(/(\d+)-foot/i);
      const zone = zoneForShot(distanceMatch ? Number(distanceMatch[1]) : null, play.score_value === 3 ? 3 : 0, `${play.type} ${playText}`);
      actor.shots.push({ playerId: actorId, zone, value: zone === "three" ? 3 : 2, made: play.scoring_play || /\bmakes\b/i.test(playText) });
    }
  }
  return activity;
}

export function inactivityNote(playerActivity: PlayerActivity | undefined, clock: GameClock, minutesPlayed: number): string | null {
  if (!playerActivity || playerActivity.lastSeenElapsed === null || clock.isFinished || minutesPlayed < 4) return null;
  const minutesSinceSeen = (clockElapsed(clock) - playerActivity.lastSeenElapsed) / 60;
  if (playerActivity.subbedOut && minutesSinceSeen >= inactiveAfterSubMinutes) return `Out since ${playerActivity.lastSeenLabel}: check for injury news`;
  if (!playerActivity.subbedOut && minutesSinceSeen >= inactiveSilentMinutes) return `No plays since ${playerActivity.lastSeenLabel}: may be out`;
  return null;
}

function recentTotals(profile: QuarterProfile | undefined): Record<"minutes" | "fga" | "fg3a" | "fgm" | "fg3m" | "fta" | "ftm", number> | null {
  if (!profile) return null;
  const totals = { minutes: 0, fga: 0, fg3a: 0, fgm: 0, fg3m: 0, fta: 0, ftm: 0 };
  for (const quarter of [1, 2, 3, 4] as const) {
    const quarterStats = profile.quarters[quarter];
    if (!quarterStats) return null;
    for (const fieldName of Object.keys(totals) as Array<keyof typeof totals>) totals[fieldName] += quarterStats[fieldName]?.average ?? 0;
  }
  return totals; // per-game averages over the last 10 games
}

function shrunkRate(made: number, attempts: number, leagueRate: number, priorAttempts: number): number {
  return (made + priorAttempts * leagueRate) / (attempts + priorAttempts);
}

export function shootingCheck(boxPlayer: BdlBoxScorePlayer, parsedShots: ParsedShot[] | undefined, shotProfile: ShotProfile | undefined, quarterProfile: QuarterProfile | undefined): ShootingCheck | null {
  const fieldGoalAttempts = boxPlayer.fga ?? 0;
  const freeThrowAttempts = boxPlayer.fta ?? 0;
  if (fieldGoalAttempts + freeThrowAttempts === 0) return null;
  const totals = recentTotals(quarterProfile);
  const games = Math.max(1, quarterProfile?.games ?? 10); // averages times games approximates his raw attempts
  const twoRate = totals ? shrunkRate((totals.fgm - totals.fg3m) * games, (totals.fga - totals.fg3a) * games, leagueTwoPointRate, 40) : leagueTwoPointRate;
  const threeRate = shotProfile ? shotProfile.zoneRates.three : totals ? shrunkRate(totals.fg3m * games, totals.fg3a * games, leagueZoneRates.three, 40) : leagueZoneRates.three;
  const freeThrowRate = totals ? shrunkRate(totals.ftm * games, totals.fta * games, leagueFreeThrowRate, 20) : leagueFreeThrowRate;
  const shotsLogged = parsedShots?.length ?? 0;
  const usePlays = shotsLogged > 0 && shotsLogged >= fieldGoalAttempts * 0.8; // the play log must cover most of the box-score attempts
  let expectedFieldGoalPoints = 0;
  let threesExpected = 0;
  if (usePlays) {
    for (const shot of parsedShots!) {
      const twoPointZoneRate = shotProfile ? shotProfile.zoneRates[shot.zone] : leagueZoneRates[shot.zone] * (twoRate / leagueTwoPointRate); // his shot-chart rate, else the league zone scaled by his 2P%
      const makeRate = shot.zone === "three" ? threeRate : twoPointZoneRate;
      expectedFieldGoalPoints += shot.value * makeRate;
      if (shot.zone === "three") threesExpected += makeRate;
    }
  } else {
    const threeAttempts = boxPlayer.fg3a ?? 0;
    threesExpected = threeAttempts * threeRate;
    expectedFieldGoalPoints = (fieldGoalAttempts - threeAttempts) * twoRate * 2 + threesExpected * 3;
  }
  const expectedPoints = expectedFieldGoalPoints + freeThrowAttempts * freeThrowRate;
  const actualPoints = boxPlayer.pts ?? 0;
  return { expectedPoints, actualPoints, luck: actualPoints - expectedPoints, threesExpected, threesMade: boxPlayer.fg3m ?? 0, source: usePlays ? "play-by-play" : "box score" };
}

export function volumeFactors(boxPlayer: BdlBoxScorePlayer, minutesPlayed: number, quarterProfile: QuarterProfile | undefined): { scoring: number; threes: number } | null {
  const totals = recentTotals(quarterProfile);
  if (!totals || totals.minutes < 8 || minutesPlayed < 6) return null; // too little time tonight or no history
  const weight = Math.min(0.5, minutesPlayed / 40); // tonight's role counts for at most half
  const typicalUsage = (totals.fga + 0.44 * totals.fta) / totals.minutes;
  const tonightUsage = ((boxPlayer.fga ?? 0) + 0.44 * (boxPlayer.fta ?? 0)) / minutesPlayed;
  const typicalThrees = totals.fg3a / totals.minutes;
  const tonightThrees = (boxPlayer.fg3a ?? 0) / minutesPlayed;
  const blend = (tonightRate: number, typicalRate: number) => (typicalRate <= 0.01 ? 1 : Math.min(1.25, Math.max(0.8, 1 + weight * (Math.min(1.6, Math.max(0.6, tonightRate / typicalRate)) - 1))));
  return { scoring: blend(tonightUsage, typicalUsage), threes: blend(tonightThrees, typicalThrees) };
}

export function readLiveMarket(liveOdds: BdlBettingOdd[], openingOdds: BdlBettingOdd[], currentPoints: number, remainingClockShare: number, tipoffIso: string | null): MarketRead | null {
  const tipoffMs = Date.parse(tipoffIso ?? "");
  const inGame = liveOdds.filter((bettingOdd) => {
    const updatedMs = Date.parse(bettingOdd.updated_at ?? "");
    return Number.isFinite(updatedMs) && Number.isFinite(tipoffMs) && updatedMs > tipoffMs + 5 * 60_000; // a line not touched since tip-off is still the pregame line
  });
  const liveTotal = median(inGame.map((bettingOdd) => Number(bettingOdd.total_value)).filter((totalValue) => Number.isFinite(totalValue) && totalValue > currentPoints));
  if (liveTotal === null) return null;
  const liveSpreadHome = median(inGame.map((bettingOdd) => Number(bettingOdd.spread_home_value)).filter((spreadValue) => Number.isFinite(spreadValue)));
  const pregameTotal = median(openingOdds.map((bettingOdd) => Number(bettingOdd.total_value)).filter((totalValue) => Number.isFinite(totalValue) && totalValue > 150));
  const pregameRemaining = pregameTotal !== null ? pregameTotal * remainingClockShare : null;
  const paceFactor = pregameRemaining !== null && remainingClockShare >= 0.1 && pregameRemaining > 0 ? Math.min(1.15, Math.max(0.85, (liveTotal - currentPoints) / pregameRemaining)) : null;
  return { liveTotal, liveSpreadHome, paceFactor, expectedFinalMarginHome: liveSpreadHome === null ? null : -liveSpreadHome, books: new Set(inGame.map((bettingOdd) => bettingOdd.vendor)).size };
}
