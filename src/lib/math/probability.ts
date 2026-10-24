export function errorFunction(inputValue: number): number {
  const sign = inputValue < 0 ? -1 : 1;
  const absolute = Math.abs(inputValue);
  const tValue = 1 / (1 + 0.3275911 * absolute); // Abramowitz-Stegun 7.1.26, max error 1.5e-7
  const polynomial = ((((1.061405429 * tValue - 1.453152027) * tValue + 1.421413741) * tValue - 0.284496736) * tValue + 0.254829592) * tValue;
  return sign * (1 - polynomial * Math.exp(-absolute * absolute));
}

export function normalCdf(inputValue: number, meanValue = 0, standardDeviation = 1): number {
  if (standardDeviation <= 0) return inputValue >= meanValue ? 1 : 0;
  return 0.5 * (1 + errorFunction((inputValue - meanValue) / (standardDeviation * Math.SQRT2)));
}

export function probabilityAtLeast(threshold: number, meanValue: number, standardDeviation: number, discrete = true): number {
  const boundary = discrete ? threshold - 0.5 : threshold; // continuity correction for integer stats
  return 1 - normalCdf(boundary, meanValue, standardDeviation);
}

export function probabilityOver(lineValue: number, meanValue: number, standardDeviation: number): number {
  const isHalfLine = Math.abs(lineValue - Math.floor(lineValue) - 0.5) < 1e-9;
  const boundary = isHalfLine ? lineValue : lineValue + 0.5; // whole-number lines push on equality
  return 1 - normalCdf(boundary, meanValue, standardDeviation);
}

export function probabilityUnder(lineValue: number, meanValue: number, standardDeviation: number): number {
  const isHalfLine = Math.abs(lineValue - Math.floor(lineValue) - 0.5) < 1e-9;
  const boundary = isHalfLine ? lineValue : lineValue - 0.5;
  return normalCdf(boundary, meanValue, standardDeviation);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((runningTotal, value) => runningTotal + value, 0) / values.length;
}

export function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  const squaredDeviations = values.reduce((runningTotal, value) => runningTotal + (value - average) ** 2, 0);
  return Math.sqrt(squaredDeviations / (values.length - 1));
}

export function hitRate(values: number[], lineValue: number): number | null {
  if (values.length === 0) return null;
  return values.filter((value) => value > lineValue).length / values.length;
}
