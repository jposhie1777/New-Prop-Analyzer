import type { SlipPick } from "@/lib/client/betSlip";
import type { HalftimeSuggestion } from "@/lib/analytics/halftimeSuggestions";
import type { LivePropRow } from "@/lib/analytics/liveSuggestions";
import type { TrackedPick, TrackKind, TrackSide } from "./tracker";
import { propMapping } from "@/lib/analytics/propTypes";
import { expectedValuePercent } from "@/lib/math/odds";
import { appSettings } from "@/config/appSettings";

type NewTracked = Omit<TrackedPick, "createdAt" | "result">;

function decimalOf(americanOdds: number): number {
  return americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / -americanOdds;
}

export function slipPickToTracked(pick: Omit<SlipPick, "addedAt">): NewTracked {
  const best = [...pick.offers].sort((first, second) => decimalOf(second.americanOdds) - decimalOf(first.americanOdds))[0] ?? null;
  const sideBySelection: Record<string, TrackSide> = { spread_home: "home", spread_away: "away", moneyline_home: "home", moneyline_away: "away", total_over: "over", total_under: "under", over: "over", under: "under" };
  const kind: TrackKind = pick.market === "prop" ? "prop" : pick.market;
  const mapping = pick.propType ? propMapping(pick.propType) : null;
  return {
    trackId: `slip-${pick.pickId}`,
    source: "slip",
    kind,
    gameId: pick.gameId,
    gameDate: pick.gameDate,
    label: pick.label,
    side: sideBySelection[pick.selectionKey] ?? "over",
    lineValue: best?.lineValue ?? null,
    americanOdds: best?.americanOdds ?? null,
    vendor: best?.vendor ?? null,
    modelProbability: pick.modelProbability,
    evPercent: pick.modelProbability !== null && best ? expectedValuePercent(pick.modelProbability, best.americanOdds) : null,
    playerId: pick.playerId,
    teamId: null,
    propType: pick.propType,
    metric: mapping?.metric ?? null,
    scope: mapping?.scope ?? null,
  };
}

export function halftimeToTracked(suggestion: HalftimeSuggestion, gameId: number, gameDate: string): NewTracked {
  const side = suggestion.evaluation.bestSide ?? "over";
  const mapping = propMapping(suggestion.propType);
  return {
    trackId: `ht-${gameId}-${suggestion.playerId}-${suggestion.propType}`,
    source: "halftime",
    kind: "prop",
    gameId,
    gameDate,
    label: `${suggestion.playerName} ${side === "over" ? "Over" : "Under"} ${suggestion.lineValue} ${mapping?.label ?? suggestion.propType}`,
    side,
    lineValue: suggestion.lineValue,
    americanOdds: side === "over" ? suggestion.bestOverOdds : suggestion.bestUnderOdds,
    vendor: side === "over" ? suggestion.bestOverVendor : suggestion.bestUnderVendor,
    modelProbability: side === "over" ? suggestion.evaluation.overProbability : suggestion.evaluation.underProbability,
    evPercent: suggestion.evaluation.bestEvPercent,
    playerId: suggestion.playerId,
    teamId: suggestion.teamId,
    propType: suggestion.propType,
    metric: mapping?.metric ?? null,
    scope: mapping?.scope ?? null,
  };
}

export function threeQuarterToTracked(gameId: number, gameDate: string, teamId: number, teamAbbreviation: string, opponentAbbreviation: string, probability: number, projection: number): NewTracked {
  return {
    trackId: `t3-${gameId}-${teamId}`,
    source: "100-in-3",
    kind: "team_three_quarters",
    gameId,
    gameDate,
    label: `${teamAbbreviation} 100+ thru 3Q vs ${opponentAbbreviation} (proj ${projection.toFixed(1)})`,
    side: "over",
    lineValue: appSettings.hundredThroughThreeTarget - 0.5,
    americanOdds: null,
    vendor: null,
    modelProbability: probability,
    evPercent: null,
    playerId: null,
    teamId,
    propType: null,
    metric: null,
    scope: "T3",
  };
}

export function livePropToTracked(propRow: LivePropRow, gameId: number, gameDate: string, clockText: string): NewTracked {
  const side = propRow.evaluation.bestSide ?? "over";
  const mapping = propMapping(propRow.propType);
  return {
    trackId: `live-${gameId}-${propRow.playerId}-${propRow.propType}`,
    source: "live",
    kind: "prop",
    gameId,
    gameDate,
    label: `${propRow.playerName} ${side === "over" ? "Over" : "Under"} ${propRow.lineValue} ${propRow.label} (${clockText})`,
    side,
    lineValue: propRow.lineValue,
    americanOdds: side === "over" ? propRow.bestOverOdds : propRow.bestUnderOdds,
    vendor: side === "over" ? propRow.bestOverVendor : propRow.bestUnderVendor,
    modelProbability: side === "over" ? propRow.evaluation.overProbability : propRow.evaluation.underProbability,
    evPercent: propRow.evaluation.bestEvPercent,
    playerId: propRow.playerId,
    teamId: propRow.teamId,
    propType: propRow.propType,
    metric: mapping?.metric ?? null,
    scope: mapping?.scope ?? null,
  };
}
