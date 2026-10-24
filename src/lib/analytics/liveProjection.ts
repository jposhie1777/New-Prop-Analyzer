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

export function clockLabel(status: string | null | undefined, time: string | null | undefined): string {
  if (!status) return time ?? "";
  if (/half/i.test(status)) return "Halftime";
  if (!time || time === status) return status;
  if (/^Q\d|^OT/i.test(time.trim())) return time.trim(); // the live feed already puts the quarter in the clock, e.g. "Q3 11:12"
  return `${status} ${time}`;
}

export interface QuarterRates {
  averages: Record<1 | 2 | 3 | 4, number>;
  variances: Record<1 | 2 | 3 | 4, number>;
}

export interface LiveProjectionResult {
  projection: number;
  remainingExpected: number;
  standardDeviation: number;
  minutesFactor: number;
  remainingShare: number;
  adjustments: string[];
}

export function foulTroubleFactor(personalFouls: number, clock: GameClock): { factor: number; note: string | null } {
  const quarterReached = clock.isHalftime ? 3 : clock.period;
  const troubleLine = Math.min(5, quarterReached + 1); // 2 fouls in Q1, 3 by the half, 4 in Q3, 5 in Q4
  if (personalFouls >= 5) return { factor: 0.65, note: `${personalFouls} fouls: minutes x0.65` };
  if (personalFouls >= troubleLine) return { factor: 0.8, note: `${personalFouls} fouls in Q${Math.min(4, quarterReached)}: minutes x0.80` };
  return { factor: 1, note: null };
}

export function projectLiveStat(currentValue: number, rates: QuarterRates, clock: GameClock, personalFouls: number, scoreMargin: number): LiveProjectionResult {
  const adjustments: string[] = [];
  let remainingExpected = 0;
  let remainingVariance = 0;
  let remainingShare = 0;
  const quarters = [1, 2, 3, 4] as const;
  if (!clock.isFinished) {
    for (const quarter of quarters) {
      let quarterShare = 0;
      if (clock.isHalftime) quarterShare = quarter >= 3 ? 1 : 0;
      else if (quarter > clock.period) quarterShare = 1;
      else if (quarter === clock.period) quarterShare = clock.secondsLeftInPeriod / 720;
      remainingExpected += rates.averages[quarter] * quarterShare;
      remainingVariance += rates.variances[quarter] * quarterShare;
      remainingShare += quarterShare / 4;
    }
    if (clock.period > 4) {
      const overtimeShare = clock.secondsLeftInPeriod / 300;
      remainingExpected += rates.averages[4] * (5 / 12) * overtimeShare; // overtime plays like a short fourth quarter
      remainingVariance += rates.variances[4] * (5 / 12) * overtimeShare;
    }
  }
  const fouls = foulTroubleFactor(personalFouls, clock);
  let factor = fouls.factor;
  if (fouls.note) adjustments.push(fouls.note);
  const secondHalfOrLater = clock.isHalftime || clock.period >= 3;
  if (secondHalfOrLater && Math.abs(scoreMargin) >= appSettings.blowoutMargin) {
    factor *= 0.8;
    adjustments.push(`margin ${Math.abs(scoreMargin)}: blowout risk x0.80`);
  }
  factor = Math.max(0.5, factor);
  const adjustedRemaining = remainingExpected * factor;
  const standardDeviation = Math.max(0.6, Math.sqrt(Math.max(remainingVariance * factor, adjustedRemaining * 0.8))); // never tighter than a Poisson-ish floor
  return { projection: currentValue + adjustedRemaining, remainingExpected: adjustedRemaining, standardDeviation, minutesFactor: factor, remainingShare, adjustments };
}
