import type { BdlBettingOdd, BdlGame, BdlPlayerProp } from "@/lib/bdl/types";
import type { SlipOffer, SlipPick } from "./betSlip";
import { medianAmerican } from "@/lib/odds/consensus";
import { propMapping } from "@/lib/analytics/propTypes";

export type GameSelection = "spread_home" | "spread_away" | "moneyline_home" | "moneyline_away" | "total_over" | "total_under";

export function formatSpread(spreadValue: number | null): string {
  if (spreadValue === null) return "-";
  if (spreadValue === 0) return "PK";
  return spreadValue > 0 ? `+${spreadValue}` : String(spreadValue);
}

function offerFor(bettingOdd: BdlBettingOdd, selection: GameSelection): SlipOffer | null {
  const selectionFields: Record<GameSelection, { odds: keyof BdlBettingOdd; line: keyof BdlBettingOdd | null }> = {
    spread_home: { odds: "spread_home_odds", line: "spread_home_value" },
    spread_away: { odds: "spread_away_odds", line: "spread_away_value" },
    moneyline_home: { odds: "moneyline_home_odds", line: null },
    moneyline_away: { odds: "moneyline_away_odds", line: null },
    total_over: { odds: "total_over_odds", line: "total_value" },
    total_under: { odds: "total_under_odds", line: "total_value" },
  };
  const fields = selectionFields[selection];
  const americanOdds = Number(bettingOdd[fields.odds]);
  if (!Number.isFinite(americanOdds) || americanOdds === 0) return null;
  const lineValue = fields.line ? Number(bettingOdd[fields.line]) : null;
  return { vendor: bettingOdd.vendor, americanOdds, lineValue: lineValue !== null && Number.isFinite(lineValue) ? lineValue : null, deeplinks: bettingOdd.deeplinks ?? null, eventDeeplinks: bettingOdd.deeplinks ?? null };
}

export function buildGamePick(game: BdlGame, odds: BdlBettingOdd[], selection: GameSelection, source: string): Omit<SlipPick, "addedAt"> | null {
  const offers = odds.filter((bettingOdd) => bettingOdd.game_id === game.id).map((bettingOdd) => offerFor(bettingOdd, selection)).filter((offer): offer is SlipOffer => offer !== null);
  if (offers.length === 0) return null;
  const offeredLines = offers.map((offer) => offer.lineValue).filter((lineValue): lineValue is number => lineValue !== null);
  const typicalLine = offeredLines.length > 0 ? mostCommonLine(offeredLines) : null; // a real line, never an average like -4.75
  const home = game.home_team.abbreviation;
  const away = game.visitor_team.abbreviation;
  const labels: Record<GameSelection, { label: string; market: SlipPick["market"] }> = {
    spread_home: { label: `${home} ${formatSpread(typicalLine)}`, market: "spread" },
    spread_away: { label: `${away} ${formatSpread(typicalLine)}`, market: "spread" },
    moneyline_home: { label: `${home} ML`, market: "moneyline" },
    moneyline_away: { label: `${away} ML`, market: "moneyline" },
    total_over: { label: `${away}/${home} Over ${typicalLine ?? "-"}`, market: "total" },
    total_under: { label: `${away}/${home} Under ${typicalLine ?? "-"}`, market: "total" },
  };
  return {
    pickId: `game-${game.id}-${selection}`,
    kind: "game",
    gameId: game.id,
    gameDate: game.date,
    market: labels[selection].market,
    selectionKey: selection,
    label: labels[selection].label,
    detail: `${away} @ ${home}`,
    propType: null,
    playerId: null,
    offers,
    modelProbability: null,
    source,
  };
}

export function buildPropPick(
  game: BdlGame,
  playerId: number,
  playerName: string,
  propType: string,
  side: "over" | "under",
  props: BdlPlayerProp[],
  gameOdds: BdlBettingOdd[],
  source: string,
  modelProbability: number | null = null,
  lineFilter: number | null = null,
): Omit<SlipPick, "addedAt"> | null {
  const matching = props.filter((prop) => prop.player_id === playerId && prop.prop_type === propType && prop.market.type === "over_under" && (lineFilter === null || Number(prop.line_value) === lineFilter)); // lineFilter picks one alternate line
  const offers: SlipOffer[] = matching.flatMap((prop) => {
    if (prop.market.type !== "over_under") return [];
    const americanOdds = side === "over" ? prop.market.over_odds : prop.market.under_odds;
    if (!Number.isFinite(americanOdds) || americanOdds === 0) return [];
    const vendorGameOdd = gameOdds.find((bettingOdd) => bettingOdd.game_id === game.id && bettingOdd.vendor === prop.vendor);
    return [{ vendor: prop.vendor, americanOdds, lineValue: Number(prop.line_value), deeplinks: prop.deeplinks ?? null, eventDeeplinks: vendorGameOdd?.deeplinks ?? null }];
  });
  if (offers.length === 0) return null;
  const mainLine = mostCommonLine(offers.map((offer) => offer.lineValue ?? 0));
  const propLabel = propMapping(propType)?.label ?? propType;
  return {
    pickId: `prop-${game.id}-${playerId}-${propType}-${side}${lineFilter === null ? "" : `-${lineFilter}`}`,
    kind: "prop",
    gameId: game.id,
    gameDate: game.date,
    market: "prop",
    selectionKey: side,
    label: `${playerName} ${side === "over" ? "Over" : "Under"} ${mainLine} ${propLabel}`,
    detail: `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`,
    propType,
    playerId,
    offers,
    modelProbability,
    source,
  };
}

export function mostCommonLine(lineValues: number[]): number {
  const counts = new Map<number, number>();
  for (const lineValue of lineValues) counts.set(lineValue, (counts.get(lineValue) ?? 0) + 1);
  return [...counts.entries()].sort((first, second) => second[1] - first[1] || first[0] - second[0])[0]?.[0] ?? 0;
}

export interface PropMarketSummary {
  playerId: number;
  propType: string;
  mainLine: number;
  bestOver: { vendor: string; odds: number; line: number } | null;
  bestUnder: { vendor: string; odds: number; line: number } | null;
  overOddsAtMain: number | null;
  underOddsAtMain: number | null;
  vendorCount: number;
  ladder: Array<{ line: number; bestOver: { vendor: string; odds: number } | null; bestUnder: { vendor: string; odds: number } | null; books: number }>;
  milestones: Array<{ threshold: number; best: { vendor: string; odds: number }; books: number }>;
}

function decimalOf(americanOdds: number): number {
  return americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / -americanOdds;
}

function bestPrice(offers: Array<{ vendor: string; odds: number }>): { vendor: string; odds: number } | null {
  return [...offers].filter((offer) => Number.isFinite(offer.odds) && offer.odds !== 0).sort((first, second) => decimalOf(second.odds) - decimalOf(first.odds))[0] ?? null;
}

export function summarizePropMarkets(props: BdlPlayerProp[]): PropMarketSummary[] {
  const grouped = new Map<string, BdlPlayerProp[]>();
  const milestoneGroups = new Map<string, BdlPlayerProp[]>();
  for (const prop of props) {
    const groupKey = `${prop.player_id}|${prop.prop_type}`;
    const target = prop.market.type === "over_under" ? grouped : milestoneGroups;
    target.set(groupKey, [...(target.get(groupKey) ?? []), prop]);
  }
  return [...grouped.values()].map((groupProps) => {
    const mainLine = mostCommonLine(groupProps.map((prop) => Number(prop.line_value)));
    const atMain = groupProps.filter((prop) => Number(prop.line_value) === mainLine);
    const overList = groupProps.flatMap((prop) => (prop.market.type === "over_under" ? [{ vendor: prop.vendor, odds: prop.market.over_odds, line: Number(prop.line_value) }] : []));
    const underList = groupProps.flatMap((prop) => (prop.market.type === "over_under" ? [{ vendor: prop.vendor, odds: prop.market.under_odds, line: Number(prop.line_value) }] : []));
    const bestOver = overList.filter((offer) => offer.line === mainLine).sort((first, second) => decimalOf(second.odds) - decimalOf(first.odds))[0] ?? null;
    const bestUnder = underList.filter((offer) => offer.line === mainLine).sort((first, second) => decimalOf(second.odds) - decimalOf(first.odds))[0] ?? null;
    const overMedian = medianAmerican(atMain.flatMap((prop) => (prop.market.type === "over_under" ? [prop.market.over_odds] : [])));
    const underMedian = medianAmerican(atMain.flatMap((prop) => (prop.market.type === "over_under" ? [prop.market.under_odds] : [])));
    return {
      playerId: groupProps[0].player_id,
      propType: groupProps[0].prop_type,
      mainLine,
      bestOver,
      bestUnder,
      overOddsAtMain: overMedian,
      underOddsAtMain: underMedian,
      vendorCount: new Set(groupProps.map((prop) => prop.vendor)).size,
      ladder: [...new Set(groupProps.map((prop) => Number(prop.line_value)))]
        .sort((first, second) => first - second)
        .map((line) => {
          const atLine = groupProps.filter((prop) => Number(prop.line_value) === line);
          return {
            line,
            bestOver: bestPrice(atLine.flatMap((prop) => (prop.market.type === "over_under" ? [{ vendor: prop.vendor, odds: prop.market.over_odds }] : []))),
            bestUnder: bestPrice(atLine.flatMap((prop) => (prop.market.type === "over_under" ? [{ vendor: prop.vendor, odds: prop.market.under_odds }] : []))),
            books: new Set(atLine.map((prop) => prop.vendor)).size,
          };
        }),
      milestones: summarizeMilestones(milestoneGroups.get(`${groupProps[0].player_id}|${groupProps[0].prop_type}`) ?? []),
    };
  });
}

function summarizeMilestones(milestoneProps: BdlPlayerProp[]): PropMarketSummary["milestones"] {
  const thresholds = [...new Set(milestoneProps.map((prop) => Number(prop.line_value)))].filter(Number.isFinite).sort((first, second) => first - second);
  return thresholds.flatMap((threshold) => {
    const atThreshold = milestoneProps.filter((prop) => Number(prop.line_value) === threshold);
    const best = bestPrice(atThreshold.flatMap((prop) => (prop.market.type === "milestone" ? [{ vendor: prop.vendor, odds: prop.market.odds }] : [])));
    return best ? [{ threshold, best, books: new Set(atThreshold.map((prop) => prop.vendor)).size }] : [];
  }); // "X+" markets: one price, pays if the player reaches X
}

export function buildMilestonePick(game: BdlGame, playerId: number, playerName: string, propType: string, threshold: number, props: BdlPlayerProp[], gameOdds: BdlBettingOdd[], source: string, modelProbability: number | null = null): Omit<SlipPick, "addedAt"> | null {
  const offers: SlipOffer[] = props.flatMap((prop) => {
    if (prop.player_id !== playerId || prop.prop_type !== propType || prop.market.type !== "milestone" || Number(prop.line_value) !== threshold) return [];
    if (!Number.isFinite(prop.market.odds) || prop.market.odds === 0) return [];
    const vendorGameOdd = gameOdds.find((bettingOdd) => bettingOdd.game_id === game.id && bettingOdd.vendor === prop.vendor);
    return [{ vendor: prop.vendor, americanOdds: prop.market.odds, lineValue: threshold - 0.5, deeplinks: prop.deeplinks ?? null, eventDeeplinks: vendorGameOdd?.deeplinks ?? null }]; // X+ grades like over X-0.5
  });
  if (offers.length === 0) return null;
  const propLabel = propMapping(propType)?.label ?? propType;
  return {
    pickId: `milestone-${game.id}-${playerId}-${propType}-${threshold}`,
    kind: "prop",
    gameId: game.id,
    gameDate: game.date,
    market: "prop",
    selectionKey: "yes",
    label: `${playerName} ${threshold}+ ${propLabel}`,
    detail: `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`,
    propType,
    playerId,
    offers,
    modelProbability,
    source,
  };
}
