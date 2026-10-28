import type { BdlBoxScore, BdlGame } from "@/lib/bdl/types";
import type { PlacedBet, PlacedLeg } from "@/lib/client/placedBets";
import { gradePick, type GradeStatus, type TrackSide, type TrackedPick } from "./tracker";
import { propMapping } from "@/lib/analytics/propTypes";
import { boxMetricValue } from "@/lib/analytics/halftimeSuggestions";
import { clockLabel } from "@/lib/analytics/liveProjection";
import { isGameFinal, isGameLive } from "@/lib/data/flatten";
import { parseMinutes } from "@/lib/dates";

export type LegState = "upcoming" | "live" | "win" | "loss" | "push" | "void" | "waiting";

export interface LegProgress {
  state: LegState;
  text: string; // "14 of 20.5", "ATL by 6"
  clock: string | null; // "Q3 5:42", "Final"
  fraction: number | null; // stat progress toward the line, for props
  onTrack: boolean | null; // live: hitting right now
}

const sideBySelection: Record<string, TrackSide> = { spread_home: "home", spread_away: "away", moneyline_home: "home", moneyline_away: "away", total_over: "over", total_under: "under", over: "over", under: "under", yes: "over" };

function legKind(leg: PlacedLeg): TrackedPick["kind"] {
  return leg.market === "prop" ? "prop" : leg.market;
}

function stateFromGrade(status: GradeStatus): LegState {
  return status === "win" || status === "loss" || status === "push" ? status : "void";
}

function propValue(leg: PlacedLeg, boxScore: BdlBoxScore): { value: number | null; played: boolean } {
  const mapping = leg.propType ? propMapping(leg.propType) : null;
  const boxPlayer = [...boxScore.home_team.players, ...boxScore.visitor_team.players].find((candidate) => candidate.player.id === leg.playerId);
  if (!mapping || mapping.scope !== "FG" || !boxPlayer) return { value: null, played: false };
  return { value: boxMetricValue(boxPlayer, mapping.metric), played: parseMinutes(boxPlayer.min) > 0 };
}

export function legProgress(leg: PlacedLeg, game: BdlGame | null, boxScore: BdlBoxScore | null, tracked: TrackedPick | null): LegProgress {
  const side = sideBySelection[leg.selectionKey] ?? "over";
  const kind = legKind(leg);
  const source = boxScore ?? game;
  if (!source || (!isGameLive(source) && !isGameFinal(source))) {
    if (tracked?.result) {
      const status = tracked.result.actual === null ? tracked.result.status : gradePick({ kind, side, lineValue: leg.lineValue }, { actual: tracked.result.actual }); // graded again at the line actually bet
      return { state: stateFromGrade(status), text: tracked.result.actual === null ? "No result" : kind === "prop" ? `Finished with ${tracked.result.actual}` : "Final", clock: "Final", fraction: null, onTrack: null };
    }
    return { state: game ? "upcoming" : "waiting", text: game ? "Not started" : "Waiting for the final", clock: null, fraction: null, onTrack: null };
  }
  const final = isGameFinal(source);
  const clock = final ? "Final" : clockLabel(source.status, source.time);
  const homeScore = source.home_team_score ?? 0;
  const visitorScore = source.visitor_team_score ?? 0;
  const homeMargin = homeScore - visitorScore;
  const homeAbbreviation = (boxScore?.home_team.team ?? game?.home_team)?.abbreviation ?? "Home";
  const visitorAbbreviation = (boxScore?.visitor_team.team ?? game?.visitor_team)?.abbreviation ?? "Away";
  if (kind === "prop") {
    if (!boxScore) return { state: final ? "waiting" : "live", text: "Waiting for the box score", clock, fraction: null, onTrack: null };
    const { value, played } = propValue(leg, boxScore);
    if (value === null || leg.lineValue === null) return { state: final ? "waiting" : "live", text: leg.propType && propMapping(leg.propType)?.scope !== "FG" ? "Graded after the game" : "Not in the box score yet", clock, fraction: null, onTrack: null };
    const over = side === "over";
    const hitting = over ? value > leg.lineValue : value < leg.lineValue;
    const fraction = Math.min(1, value / Math.max(leg.lineValue, 0.5));
    if (final) {
      if (!played) return { state: "void", text: "Did not play", clock, fraction, onTrack: null };
      return { state: stateFromGrade(gradePick({ kind, side, lineValue: leg.lineValue }, { actual: value })), text: `${value} of ${leg.lineValue}`, clock, fraction, onTrack: null };
    }
    if (over && value > leg.lineValue) return { state: "win", text: `${value} of ${leg.lineValue} · cashed`, clock, fraction: 1, onTrack: true }; // an over can't come back down
    if (!over && value > leg.lineValue) return { state: "loss", text: `${value} of ${leg.lineValue} · over the line`, clock, fraction: 1, onTrack: false };
    return { state: "live", text: `${value} of ${leg.lineValue}`, clock, fraction, onTrack: hitting };
  }
  const leader = homeMargin === 0 ? "Tied" : homeMargin > 0 ? `${homeAbbreviation} by ${homeMargin}` : `${visitorAbbreviation} by ${-homeMargin}`;
  if (kind === "total") {
    const total = homeScore + visitorScore;
    const status = gradePick({ kind, side, lineValue: leg.lineValue }, { actual: total });
    if (final) return { state: stateFromGrade(status), text: `${total} total`, clock, fraction: null, onTrack: null };
    if (side === "over" && leg.lineValue !== null && total > leg.lineValue) return { state: "win", text: `${total} total · cashed`, clock, fraction: 1, onTrack: true };
    return { state: "live", text: `${total} total (${visitorScore}-${homeScore})`, clock, fraction: leg.lineValue ? Math.min(1, total / leg.lineValue) : null, onTrack: null };
  }
  const status = gradePick({ kind, side, lineValue: leg.lineValue }, { actual: homeMargin });
  if (final) return { state: stateFromGrade(status), text: leader, clock, fraction: null, onTrack: null };
  return { state: "live", text: `${leader} · ${status === "win" ? "covering" : status === "push" ? "on the number" : "not covering"}`, clock, fraction: null, onTrack: status === "win" ? true : status === "push" ? null : false };
}

export function betState(legStates: LegState[]): LegState {
  if (legStates.includes("loss")) return "loss";
  const settled = legStates.every((state) => state === "win" || state === "push" || state === "void");
  if (settled) return legStates.some((state) => state === "win") ? "win" : legStates.every((state) => state === "void") ? "void" : "push";
  if (legStates.some((state) => state === "live" || state === "win")) return "live";
  if (legStates.includes("waiting")) return "waiting";
  return "upcoming";
}

export function betLegsKey(bet: PlacedBet): string {
  return bet.legs.map((leg) => leg.pickId).join(",");
}
