import type { BdlBettingOdd } from "@/lib/bdl/types";
import { evaluateGameLines, marketConsensus, type GameProjection, type LineEdge } from "@/lib/analytics/gameModel";
import { rateConfidence, confidenceTag, type ConfidenceRating } from "@/lib/analytics/confidence";
import type { TrackedPick } from "@/lib/tracking/tracker";
import { ncaabOutcomeSpread, ncaabTooFarLimits, projectNcaabGame, type LeagueAverages, type TeamRatingLine } from "./ratings";
import { ncaabGameDate, type NcaabGame } from "./types";

export interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{ key: string; title: string; last_update: string; markets: Array<{ key: string; outcomes: OddsApiOutcome[] }> }>;
}

const vendorNames: Record<string, string> = { williamhill_us: "caesars", espnbet: "espnbet", fanatics: "fanatics", betrivers: "betrivers", ballybet: "bally", hardrockbet: "hardrock" }; // Odds API keys that differ from the app's vendor names

export function teamNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[.'’()]/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bstate\b/g, "st")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameScore(oddsName: string, team: NcaabGame["home_team"]): number {
  const key = teamNameKey(oddsName);
  if (key === teamNameKey(team.full_name)) return 100;
  if (key === teamNameKey(team.college)) return 90;
  if (key.startsWith(`${teamNameKey(team.college)} `) && key.endsWith(teamNameKey(team.name))) return 85; // "Miami OH RedHawks" vs college "Miami (OH)"
  const oddsTokens = new Set(key.split(" "));
  const teamTokens = teamNameKey(team.full_name).split(" ");
  const shared = teamTokens.filter((token) => oddsTokens.has(token)).length;
  return (shared / Math.max(teamTokens.length, oddsTokens.size)) * 70; // partial overlap, never beats an exact name
}

export interface EventMatch {
  matched: Map<number, OddsApiEvent>; // BDL game id to Odds API event
  unmatched: OddsApiEvent[];
}

export function matchOddsEvents(events: OddsApiEvent[], games: NcaabGame[]): EventMatch {
  const matched = new Map<number, OddsApiEvent>();
  const unmatched: OddsApiEvent[] = [];
  for (const event of events) {
    const eventDay = ncaabGameDate({ date: event.commence_time });
    let best: { game: NcaabGame; score: number } | null = null;
    for (const game of games) {
      if (matched.has(game.id) || ncaabGameDate(game) !== eventDay) continue;
      const score = Math.min(nameScore(event.home_team, game.home_team), nameScore(event.away_team, game.visitor_team));
      const swappedScore = Math.min(nameScore(event.home_team, game.visitor_team), nameScore(event.away_team, game.home_team)) - 10; // neutral-site games are sometimes listed the other way round
      const gameScore = Math.max(score, swappedScore);
      if (!best || gameScore > best.score) best = { game, score: gameScore };
    }
    if (best && best.score >= 45) matched.set(best.game.id, event);
    else unmatched.push(event);
  }
  return { matched, unmatched };
}

export function eventToBettingOdds(event: OddsApiEvent, game: NcaabGame): BdlBettingOdd[] {
  const homeFirst = nameScore(event.home_team, game.home_team) >= nameScore(event.home_team, game.visitor_team);
  const bdlHomeName = homeFirst ? event.home_team : event.away_team; // the BDL home team's name on the Odds API side
  return event.bookmakers.map((bookmaker, bookIndex) => {
    const market = (key: string) => bookmaker.markets.find((candidate) => candidate.key === key)?.outcomes ?? [];
    const sideOf = (outcomes: OddsApiOutcome[], home: boolean) => outcomes.find((outcome) => (outcome.name === bdlHomeName) === home);
    const spreadHome = sideOf(market("spreads"), true);
    const spreadAway = sideOf(market("spreads"), false);
    const moneylineHome = sideOf(market("h2h"), true);
    const moneylineAway = sideOf(market("h2h"), false);
    const over = market("totals").find((outcome) => outcome.name === "Over");
    const under = market("totals").find((outcome) => outcome.name === "Under");
    return {
      id: game.id * 100 + bookIndex,
      game_id: game.id,
      vendor: vendorNames[bookmaker.key] ?? bookmaker.key,
      spread_home_value: spreadHome?.point === undefined ? null : String(spreadHome.point),
      spread_home_odds: spreadHome?.price ?? null,
      spread_away_value: spreadAway?.point === undefined ? null : String(spreadAway.point),
      spread_away_odds: spreadAway?.price ?? null,
      moneyline_home_odds: moneylineHome?.price ?? null,
      moneyline_away_odds: moneylineAway?.price ?? null,
      total_value: over?.point === undefined ? null : String(over.point),
      total_over_odds: over?.price ?? null,
      total_under_odds: under?.price ?? null,
      updated_at: bookmaker.last_update,
    };
  });
}

export interface NcaabGameAnalysis {
  projection: GameProjection;
  seasonOnlyProjection: GameProjection | null; // this season's numbers alone, for the models-agree check
  edges: LineEdge[];
  confidence: Map<string, ConfidenceRating>; // by selection
}

export interface AnalysisInputs {
  game: NcaabGame;
  home: { blended: TeamRatingLine; season: TeamRatingLine | null };
  away: { blended: TeamRatingLine; season: TeamRatingLine | null };
  league: LeagueAverages;
  odds: BdlBettingOdd[];
  openingOdds: BdlBettingOdd[] | null;
  evThresholdPercent: number;
  marketRecords: Map<string, { decided: number; roiPercent: number | null }>; // by market
}

export function analyzeNcaabGame(inputs: AnalysisInputs): NcaabGameAnalysis {
  const { game, home, away, league, odds, openingOdds, evThresholdPercent, marketRecords } = inputs;
  const neutral = game.postseason; // tournament games are on neutral floors
  const projection = projectNcaabGame(home.blended, away.blended, league, neutral);
  const seasonOnlyProjection = home.season && away.season && home.season.games >= 3 && away.season.games >= 3 ? projectNcaabGame(home.season, away.season, league, neutral) : null;
  const homeAbbreviation = game.home_team.abbreviation || game.home_team.college;
  const awayAbbreviation = game.visitor_team.abbreviation || game.visitor_team.college;
  const evaluate = (candidate: GameProjection) => evaluateGameLines(candidate, odds, homeAbbreviation, awayAbbreviation, evThresholdPercent, ncaabOutcomeSpread, ncaabTooFarLimits);
  const edges = evaluate(projection);
  const otherEdges = seasonOnlyProjection ? evaluate(seasonOnlyProjection) : [];
  const opening = openingOdds && openingOdds.length > 0 ? marketConsensus(openingOdds) : null;
  const confidence = new Map<string, ConfidenceRating>();
  for (const edge of edges) {
    const openingMarketValue = !opening ? null : edge.market === "spread" ? opening.spreadHome : edge.market === "total" ? opening.total : opening.homeNoVig;
    confidence.set(
      edge.selection,
      rateConfidence({
        edge,
        otherModelEdge: otherEdges.find((other) => other.selection === edge.selection) ?? null,
        openingMarketValue,
        marketRecord: marketRecords.get(edge.market) ?? null,
        sampleGames: Math.min(home.season?.games ?? 0, away.season?.games ?? 0),
        injuryAdjusted: false,
      }),
    );
  }
  return { projection, seasonOnlyProjection, edges, confidence };
}

export function ncaabPickFromEdge(edge: LineEdge, game: NcaabGame, projection: GameProjection, confidence: ConfidenceRating | null, createdAt: string): TrackedPick {
  const side = edge.selection.endsWith("home") ? "home" : edge.selection.endsWith("away") ? "away" : edge.selection === "total_over" ? "over" : "under";
  const tags = [edge.market === "total" ? "Totals" : edge.market === "spread" ? "Spreads" : "Moneylines"];
  if (confidence) tags.push(confidenceTag(confidence.level));
  if (game.postseason) tags.push("Neutral site");
  return {
    trackId: `ncaab:${game.id}:${edge.selection}`,
    createdAt,
    source: "model",
    kind: edge.market,
    gameId: game.id,
    gameDate: ncaabGameDate(game),
    label: `${edge.sideLabel} · ${game.visitor_team.college} @ ${game.home_team.college}`,
    side,
    lineValue: edge.line,
    americanOdds: edge.americanOdds,
    vendor: edge.vendor,
    modelProbability: edge.modelProbability,
    evPercent: edge.evPercent,
    playerId: null,
    teamId: null,
    propType: null,
    metric: null,
    scope: null,
    result: null,
    projectedValue: edge.market === "total" ? projection.total : projection.margin,
    marketValue: edge.marketValue,
    tags,
  };
}
