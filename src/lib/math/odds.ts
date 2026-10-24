export function americanToDecimal(americanOdds: number): number {
  if (!Number.isFinite(americanOdds) || americanOdds === 0) throw new Error(`invalid American odds: ${americanOdds}`);
  return americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / -americanOdds;
}

export function decimalToAmerican(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) throw new Error(`invalid decimal odds: ${decimalOdds}`);
  return decimalOdds >= 2 ? Math.round((decimalOdds - 1) * 100) : Math.round(-100 / (decimalOdds - 1));
}

export function americanToImpliedProbability(americanOdds: number): number {
  return 1 / americanToDecimal(americanOdds); // includes the book's vig
}

export function probabilityToAmerican(probability: number): number {
  if (!(probability > 0 && probability < 1)) throw new Error(`probability must be between 0 and 1: ${probability}`);
  return decimalToAmerican(1 / probability);
}

export interface NoVigResult {
  fairProbabilities: number[];
  overround: number;
  vigPercent: number;
}

export function removeVig(americanOddsList: number[]): NoVigResult {
  const impliedList = americanOddsList.map(americanToImpliedProbability);
  const overround = impliedList.reduce((runningTotal, implied) => runningTotal + implied, 0);
  return {
    fairProbabilities: impliedList.map((implied) => implied / overround), // multiplicative normalization
    overround,
    vigPercent: (overround - 1) * 100,
  };
}

export function noVigTwoWay(sideOdds: number, otherSideOdds: number): number {
  return removeVig([sideOdds, otherSideOdds]).fairProbabilities[0];
}

export function expectedValuePercent(winProbability: number, americanOdds: number): number {
  return (winProbability * americanToDecimal(americanOdds) - 1) * 100; // profit per 100 staked
}

export function parlayDecimalOdds(americanLegs: number[]): number {
  if (americanLegs.length === 0) return 1;
  return americanLegs.reduce((runningProduct, legOdds) => runningProduct * americanToDecimal(legOdds), 1);
}

export function parlayAmericanOdds(americanLegs: number[]): number {
  return decimalToAmerican(parlayDecimalOdds(americanLegs));
}

export function parlayProbability(legProbabilities: number[]): number {
  return legProbabilities.reduce((runningProduct, legProbability) => runningProduct * legProbability, 1); // assumes independent legs
}

export function kellyFraction(winProbability: number, americanOdds: number, fractionMultiplier = 0.25): number {
  const netOdds = americanToDecimal(americanOdds) - 1;
  const fullKelly = (netOdds * winProbability - (1 - winProbability)) / netOdds;
  return Math.max(0, fullKelly * fractionMultiplier); // never suggest a negative stake
}

export function payoutFor(stake: number, americanOdds: number): number {
  return stake * americanToDecimal(americanOdds);
}

export function formatAmerican(americanOdds: number | null | undefined): string {
  if (americanOdds === null || americanOdds === undefined || !Number.isFinite(americanOdds)) return "-";
  return americanOdds > 0 ? `+${americanOdds}` : String(americanOdds);
}
