import { implausibleEvPercent, type LineEdge } from "./gameModel";

export type ConfidenceLevel = "very-high" | "high" | "medium" | "low" | "very-low";

export interface ConfidencePart {
  label: string;
  points: number;
  maximum: number;
  note: string;
}

export interface ConfidenceRating {
  score: number; // 0-100 in steps of 5
  level: ConfidenceLevel; // one of five tiers
  parts: ConfidencePart[];
}

export interface ConfidenceInputs {
  edge: LineEdge;
  otherModelEdge: LineEdge | null; // the other model version's price on the same side
  openingMarketValue: number | null; // consensus home spread, total or no-vig home win chance at the open
  marketRecord: { decided: number; roiPercent: number | null } | null; // the model's graded results in this market
  sampleGames: number; // games this season for the team with fewer
  injuryAdjusted: boolean;
}

export const confidenceLevels: Record<ConfidenceLevel, { label: string; minimum: number }> = {
  "very-high": { label: "Very high", minimum: 80 },
  high: { label: "High", minimum: 65 },
  medium: { label: "Medium", minimum: 50 },
  low: { label: "Low", minimum: 35 },
  "very-low": { label: "Very low", minimum: 0 },
};

export const confidenceTiers: ConfidenceLevel[] = ["very-high", "high", "medium", "low", "very-low"];

export const confidenceStep = 5;

export function confidenceTag(level: ConfidenceLevel): string {
  return `Confidence: ${confidenceLevels[level].label.toLowerCase()}`; // for the Record breakdown
}

export const confidenceWeights = { edge: 35, agreement: 20, movement: 15, record: 15, data: 15 }; // adds to 100
const fullEdgePercent = 12; // EV at which the edge part is full
const minimumGradedForRecord = 30;
const fullSampleGames = 10;

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

function movementTowardPick(edge: LineEdge, openingMarketValue: number | null): number | null {
  if (edge.marketValue === null || openingMarketValue === null) return null;
  const change = edge.marketValue - openingMarketValue;
  const threshold = edge.market === "moneyline" ? 0.02 : 0.5;
  if (Math.abs(change) < threshold) return 0;
  const homeSide = edge.selection.endsWith("home");
  if (edge.market === "spread") return (homeSide ? change < 0 : change > 0) ? 1 : -1; // the home spread getting more negative backs the home side
  if (edge.market === "total") return (edge.selection === "total_over" ? change > 0 : change < 0) ? 1 : -1;
  return (homeSide ? change > 0 : change < 0) ? 1 : -1; // home win chance rising backs the home side
}

export function confidenceLevel(score: number): ConfidenceLevel {
  return confidenceTiers.find((tier) => score >= confidenceLevels[tier].minimum) ?? "very-low";
}

export function rateConfidence(inputs: ConfidenceInputs): ConfidenceRating {
  const { edge, otherModelEdge, openingMarketValue, marketRecord, sampleGames, injuryAdjusted } = inputs;
  const parts: ConfidencePart[] = [];

  const suspicious = edge.tooFar || edge.evPercent >= implausibleEvPercent;
  const edgePoints = suspicious ? 0 : confidenceWeights.edge * clamp(edge.evPercent / fullEdgePercent);
  parts.push({ label: "Edge", points: edgePoints, maximum: confidenceWeights.edge, note: suspicious ? "Far from the market: usually news the model has not seen" : `${edge.evPercent.toFixed(1)}% EV (full marks at ${fullEdgePercent}%)` });

  const agreementPoints = !otherModelEdge ? confidenceWeights.agreement / 2 : otherModelEdge.evPercent > 0 ? confidenceWeights.agreement : otherModelEdge.evPercent > -2 ? confidenceWeights.agreement / 2 : 0;
  parts.push({ label: "Models agree", points: agreementPoints, maximum: confidenceWeights.agreement, note: !otherModelEdge ? "Only one model priced it" : otherModelEdge.evPercent > 0 ? "Original and learned models both like this side" : otherModelEdge.evPercent > -2 ? "The other model is close to neutral" : "The other model leans the other way" });

  const movement = movementTowardPick(edge, openingMarketValue);
  const movementPoints = movement === null || movement === 0 ? confidenceWeights.movement / 2 : movement > 0 ? confidenceWeights.movement : 0;
  parts.push({ label: "Line movement", points: movementPoints, maximum: confidenceWeights.movement, note: movement === null ? "No opening line" : movement === 0 ? "Line has barely moved since the open" : movement > 0 ? "The market moved toward this side since the open" : "The market moved away from this side" });

  const hasRecord = marketRecord && marketRecord.decided >= minimumGradedForRecord && marketRecord.roiPercent !== null;
  const recordPoints = hasRecord ? confidenceWeights.record * clamp((marketRecord!.roiPercent! + 10) / 20) : confidenceWeights.record / 2;
  parts.push({ label: "Track record", points: recordPoints, maximum: confidenceWeights.record, note: hasRecord ? `${marketRecord!.roiPercent! >= 0 ? "+" : ""}${marketRecord!.roiPercent!.toFixed(1)}% ROI over ${marketRecord!.decided} graded ${edge.market} picks` : `Fewer than ${minimumGradedForRecord} graded ${edge.market} picks yet` });

  const dataPoints = Math.max(0, confidenceWeights.data * clamp(sampleGames / fullSampleGames) - (injuryAdjusted ? 5 : 0));
  parts.push({ label: "Data", points: dataPoints, maximum: confidenceWeights.data, note: `${sampleGames} games this season for the thinner team${injuryAdjusted ? ", and injuries add guesswork" : ""}` });

  const score = Math.round(parts.reduce((runningTotal, part) => runningTotal + part.points, 0) / confidenceStep) * confidenceStep; // steps of 5, no false precision
  return { score, level: confidenceLevel(score), parts };
}
