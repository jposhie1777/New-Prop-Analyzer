export function hashText(text: string): number {
  let hashValue = 2166136261; // FNV-1a offset basis
  for (let charIndex = 0; charIndex < text.length; charIndex++) {
    hashValue ^= text.charCodeAt(charIndex);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return hashValue >>> 0;
}

export class SeededRandom {
  private stateValue: number;

  constructor(seedText: string) {
    this.stateValue = hashText(seedText) || 1;
  }

  next(): number {
    this.stateValue = (this.stateValue + 0x6d2b79f5) >>> 0; // mulberry32
    let mixed = this.stateValue;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }

  between(lowValue: number, highValue: number): number {
    return lowValue + (highValue - lowValue) * this.next();
  }

  integerBetween(lowValue: number, highValue: number): number {
    return Math.floor(this.between(lowValue, highValue + 1));
  }

  poisson(meanValue: number): number {
    if (meanValue <= 0) return 0;
    const threshold = Math.exp(-meanValue); // Knuth's method, fine for small means
    let product = 1;
    let eventCount = 0;
    do {
      eventCount += 1;
      product *= this.next();
    } while (product > threshold);
    return eventCount - 1;
  }

  binomial(trialCount: number, successChance: number): number {
    let successes = 0;
    for (let trialIndex = 0; trialIndex < trialCount; trialIndex++) if (this.next() < successChance) successes += 1;
    return successes;
  }

  shuffle<ItemType>(items: ItemType[]): ItemType[] {
    const copy = [...items];
    for (let swapIndex = copy.length - 1; swapIndex > 0; swapIndex--) {
      const otherIndex = Math.floor(this.next() * (swapIndex + 1));
      [copy[swapIndex], copy[otherIndex]] = [copy[otherIndex], copy[swapIndex]];
    }
    return copy;
  }
}
