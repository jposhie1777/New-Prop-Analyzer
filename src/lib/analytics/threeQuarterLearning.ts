export interface ThreeQuarterSample {
  sampleKey: string; // game and team
  gameId: number;
  teamId: number;
  gameDate: string;
  season: number;
  rating: number; // the unlearned rating that morning
  lineChance: number; // the line-based part alone
  hit: boolean; // scored 100+ through three quarters
}

export interface ThreeQuarterCalibration {
  sampleCount: number;
  intercept: number; // learned chance = sigmoid(intercept + slope * logit(rating))
  slope: number;
  averageRating: number | null;
  hitRate: number | null;
}

export const threeQuarterLearningPriors = {
  penalty: 25, // pulls the curve toward "the rating is right" until roughly 150+ team-games say otherwise
  windowGames: 1500,
};

function logit(probability: number): number {
  const bounded = Math.min(0.995, Math.max(0.005, probability));
  return Math.log(bounded / (1 - bounded));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function learnThreeQuarterCalibration(samples: ThreeQuarterSample[], beforeDate: string | null = null): ThreeQuarterCalibration {
  const usable = samples
    .filter((sample) => beforeDate === null || sample.gameDate < beforeDate) // never learn from the day being predicted or later
    .sort((first, second) => second.gameDate.localeCompare(first.gameDate))
    .slice(0, threeQuarterLearningPriors.windowGames);
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 25; iteration++) {
    let gradientIntercept = 2 * threeQuarterLearningPriors.penalty * intercept; // ridge penalty toward intercept 0, slope 1
    let gradientSlope = 2 * threeQuarterLearningPriors.penalty * (slope - 1);
    let curvatureII = 2 * threeQuarterLearningPriors.penalty;
    let curvatureIS = 0;
    let curvatureSS = 2 * threeQuarterLearningPriors.penalty;
    for (const sample of usable) {
      const feature = logit(sample.rating);
      const predicted = sigmoid(intercept + slope * feature);
      const residual = predicted - (sample.hit ? 1 : 0);
      const weight = predicted * (1 - predicted);
      gradientIntercept += residual;
      gradientSlope += residual * feature;
      curvatureII += weight;
      curvatureIS += weight * feature;
      curvatureSS += weight * feature * feature;
    }
    const determinant = curvatureII * curvatureSS - curvatureIS * curvatureIS;
    if (Math.abs(determinant) < 1e-9) break;
    const stepIntercept = (curvatureSS * gradientIntercept - curvatureIS * gradientSlope) / determinant; // Newton step for logistic regression
    const stepSlope = (curvatureII * gradientSlope - curvatureIS * gradientIntercept) / determinant;
    intercept -= stepIntercept;
    slope -= stepSlope;
    if (Math.abs(stepIntercept) + Math.abs(stepSlope) < 1e-7) break;
  }
  const count = usable.length;
  return {
    sampleCount: count,
    intercept,
    slope,
    averageRating: count > 0 ? usable.reduce((runningTotal, sample) => runningTotal + sample.rating, 0) / count : null,
    hitRate: count > 0 ? usable.filter((sample) => sample.hit).length / count : null,
  };
}

export function calibrateRating(rating: number, calibration: ThreeQuarterCalibration): number {
  return sigmoid(calibration.intercept + calibration.slope * logit(rating));
}
