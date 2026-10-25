import { appSettings } from "@/config/appSettings";

export interface GameClock {
  period: number;
  secondsLeftInPeriod: number;
  isHalftime: boolean;
  isFinished: boolean;
}

export function parseGameClock(status: string | null | undefined, time: string | null | undefined, period: number | null | undefined): GameClock {
  const statusText = `${status ?? ""} ${time ?? ""}`.toLowerCase();
  const periodNumber = Math.max(1, Number(period ?? 1) || 1);
  if (statusText.includes("final")) return { period: periodNumber, secondsLeftInPeriod: 0, isHalftime: false, isFinished: true };
  if (statusText.includes("halftime") || (statusText.includes("half") && periodNumber <= 2)) return { period: 2, secondsLeftInPeriod: 0, isHalftime: true, isFinished: false };
  const clockMatch = (time ?? "").match(/(\d{1,2}):(\d{2})(?:\.\d+)?/); // "5:42", "Q3 11:12", "0:31.4"
  const periodLength = periodNumber <= 4 ? 720 : 300;
  const secondsLeftInPeriod = clockMatch ? Math.min(periodLength, Number(clockMatch[1]) * 60 + Number(clockMatch[2])) : statusText.includes("end") ? 0 : periodLength;
  return { period: periodNumber, secondsLeftInPeriod, isHalftime: false, isFinished: false };
}

export function restOfGameAverage(quarterAverages: [number, number, number, number] | null, clock: GameClock): { value: number; label: string } | null {
  if (!quarterAverages || clock.isFinished || clock.period > 4) return null; // overtime has no quarter history
  const secondsLeft = clock.isHalftime ? 0 : clock.secondsLeftInPeriod;
  let value = (secondsLeft / 720) * quarterAverages[clock.period - 1]; // only the part of this quarter still to play
  for (let quarter = clock.period + 1; quarter <= 4; quarter += 1) value += quarterAverages[quarter - 1];
  const labelStart = secondsLeft <= 360 ? clock.period + 1 : clock.period; // past the midpoint, name the quarters still to come
  const label = labelStart > 4 ? "rest of Q4" : labelStart === 4 ? "Q4" : labelStart === 3 ? "2H" : `Q${labelStart}–4`;
  if (labelStart > 4 && secondsLeft === 0) return null;
  return { value, label };
}

export function clockLabel(status: string | null | undefined, time: string | null | undefined): string {
  if (!status) return time ?? "";
  if (/half/i.test(status)) return "Halftime";
  if (!time || time === status) return status;
  if (/^Q\d|^OT/i.test(time.trim())) return time.trim(); // the live feed already puts the quarter in the clock, e.g. "Q3 11:12"
  return `${status} ${time}`;
}

export interface LivePrior {
  fullGameMean: number; // expected full-game value before tip: the pregame line, else the last-10 average
  quarterShares: Record<1 | 2 | 3 | 4, number>; // the player's usual split of that stat by quarter, sums to 1
  dispersion: number; // variance-to-mean ratio of the stat (points score in 2s and 3s, so > 1)
  source: "pregame line" | "last 10";
}

export interface LiveProjectionResult {
  projection: number;
  remainingExpected: number;
  standardDeviation: number;
  minutesFactor: number;
  remainingShare: number;
  elapsedShare: number;
  paceWeight: number;
  adjustments: string[];
}

export const statDispersion: Record<string, number> = { pts: 2.2, reb: 1.3, ast: 1.3, fg3m: 1.4, stl: 1.1, blk: 1.2, pra: 2.0, pr: 2.0, pa: 2.0, ra: 1.4, stocks: 1.2 };

export function normalizeShares(rawShares: [number, number, number, number]): Record<1 | 2 | 3 | 4, number> {
  const total = rawShares.reduce((runningTotal, share) => runningTotal + Math.max(0, share), 0);
  if (total <= 0) return { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25 };
  const blended = rawShares.map((share) => 0.7 * (Math.max(0, share) / total) + 0.3 * 0.25); // shrink noisy 10-game splits toward an even split
  return { 1: blended[0], 2: blended[1], 3: blended[2], 4: blended[3] };
}

export function timeShares(clock: GameClock, shares: Record<1 | 2 | 3 | 4, number>): { remaining: number; elapsed: number; remainingClock: number } {
  let remaining = 0;
  let elapsed = 0;
  let remainingClock = 0;
  for (const quarter of [1, 2, 3, 4] as const) {
    let leftInQuarter = 0;
    if (clock.isFinished) leftInQuarter = 0;
    else if (clock.isHalftime) leftInQuarter = quarter >= 3 ? 1 : 0;
    else if (quarter > clock.period) leftInQuarter = 1;
    else if (quarter === clock.period) leftInQuarter = clock.secondsLeftInPeriod / 720;
    remaining += shares[quarter] * leftInQuarter;
    elapsed += shares[quarter] * (1 - leftInQuarter);
    remainingClock += leftInQuarter / 4;
  }
  if (clock.period > 4 && !clock.isFinished) remaining += shares[4] * (5 / 12) * (clock.secondsLeftInPeriod / 300); // overtime plays like a short fourth quarter
  return { remaining, elapsed, remainingClock };
}

export function projectLiveStat(currentValue: number, prior: LivePrior, clock: GameClock, personalFouls: number, scoreMargin: number): LiveProjectionResult {
  const adjustments: string[] = [];
  const { remaining, elapsed, remainingClock } = timeShares(clock, prior.quarterShares);
  const priorRemaining = prior.fullGameMean * remaining;
  const paceWeight = Math.min(0.35, 0.45 * elapsed * elapsed); // early minutes are noise: ~1% at 20% of the game, ~11% at the half, at most 35%
  const paceRemaining = elapsed > 0 ? (currentValue / elapsed) * remaining : priorRemaining;
  let remainingExpected = (1 - paceWeight) * priorRemaining + paceWeight * paceRemaining;
  if (paceWeight > 0) adjustments.push(`tonight's pace weight ${Math.round(paceWeight * 100)}%`);
  const fouls = foulTroubleFactor(personalFouls, clock);
  let factor = fouls.factor;
  if (fouls.note) adjustments.push(fouls.note);
  const secondHalfOrLater = clock.isHalftime || clock.period >= 3;
  if (secondHalfOrLater && Math.abs(scoreMargin) >= appSettings.blowoutMargin) {
    factor *= 0.85;
    adjustments.push(`margin ${Math.abs(scoreMargin)}: blowout risk x0.85`);
  }
  factor = Math.max(0.5, factor);
  remainingExpected *= factor;
  const standardDeviation = Math.max(0.6, Math.sqrt(Math.max(remainingExpected, 0.3) * prior.dispersion * 1.15)); // overdispersed Poisson for what is left
  return { projection: currentValue + remainingExpected, remainingExpected, standardDeviation, minutesFactor: factor, remainingShare: remainingClock, elapsedShare: elapsed, paceWeight, adjustments };
}

export function foulTroubleFactor(personalFouls: number, clock: GameClock): { factor: number; note: string | null } {
  const quarterReached = clock.isHalftime ? 3 : clock.period;
  const troubleLine = Math.min(5, quarterReached + 1); // 2 fouls in Q1, 3 by the half, 4 in Q3, 5 in Q4
  if (personalFouls >= 5) return { factor: 0.65, note: `${personalFouls} fouls: minutes x0.65` };
  if (personalFouls >= troubleLine) return { factor: 0.8, note: `${personalFouls} fouls in Q${Math.min(4, quarterReached)}: minutes x0.80` };
  return { factor: 1, note: null };
}
