import { describe, expect, it } from "vitest";
import { fillTemplate, resolvePropLink, resolveSelectionLink, vendorLabel } from "@/lib/odds/deeplinks";
import { buildGamePick, buildMilestonePick, buildPropPick, mostCommonLine, summarizePropMarkets } from "@/lib/client/pickBuilders";
import type { BdlBettingOdd, BdlGame, BdlPlayerProp } from "@/lib/bdl/types";
import { bdlTeam } from "@/lib/nba/teams";

const settings = { sportsbookState: "nj", wagerAmount: 10, pickType: "single" };

describe("deeplinks", () => {
  it("fills state, wager and pick type placeholders", () => {
    expect(fillTemplate({ url: null, url_template: "https://{state}.betrivers.com/#event/1?coupon={pickType}|55|{wagerAmount}" }, settings)).toBe("https://nj.betrivers.com/#event/1?coupon=single|55|10");
    expect(fillTemplate({ url: "https://sportsbook.fanduel.com/x", url_template: null }, settings)).toBe("https://sportsbook.fanduel.com/x");
  });

  it("refuses unknown placeholders and non-https links", () => {
    expect(fillTemplate({ url_template: "https://book.example/{mystery}" }, settings)).toBeNull();
    expect(fillTemplate({ url: null, url_template: "javascript:alert(1)" }, settings)).toBeNull();
    expect(fillTemplate(null, settings)).toBeNull();
  });

  it("falls back from selection to event links", () => {
    const deeplinks = { event: { url: "https://book.example/event" }, selections: { spread_home: { url_template: "https://{state}.book.example/sel" } } };
    expect(resolveSelectionLink(deeplinks, "spread_home", settings)).toEqual({ href: "https://nj.book.example/sel", kind: "selection" });
    expect(resolveSelectionLink(deeplinks, "total_over", settings)).toEqual({ href: "https://book.example/event", kind: "event" });
    expect(resolveSelectionLink(null, "total_over", settings)).toBeNull();
  });

  it("sends FanDuel and DraftKings props to the event page", () => {
    const propLinks = { event: { url: "https://fd.example/event" }, selections: { over: { url: "https://fd.example/over" } } };
    expect(resolvePropLink("fanduel", propLinks, "over", settings)?.kind).toBe("event");
    expect(resolvePropLink("caesars", propLinks, "over", settings)).toEqual({ href: "https://fd.example/over", kind: "selection" });
    expect(resolvePropLink("draftkings", null, "over", settings, { event: { url: "https://dk.example/game" } })).toEqual({ href: "https://dk.example/game", kind: "event" });
    expect(vendorLabel("betmgm")).toBe("BetMGM");
  });
});

describe("pick builders", () => {
  const game = { id: 9, date: "2026-10-24", home_team: bdlTeam(2), visitor_team: bdlTeam(20) } as BdlGame;
  const odds = [
    { id: 1, game_id: 9, vendor: "fanduel", spread_home_value: "-4.5", spread_home_odds: -110, spread_away_value: "4.5", spread_away_odds: -110, moneyline_home_odds: -190, moneyline_away_odds: 160, total_value: "221.5", total_over_odds: -105, total_under_odds: -115, deeplinks: null },
    { id: 2, game_id: 9, vendor: "draftkings", spread_home_value: "-5", spread_home_odds: -108, spread_away_value: "5", spread_away_odds: -112, moneyline_home_odds: null, moneyline_away_odds: null, total_value: "222", total_over_odds: -110, total_under_odds: -110, deeplinks: null },
  ] as BdlBettingOdd[];

  it("builds game picks with one offer per book", () => {
    const pick = buildGamePick(game, odds, "spread_home", "test")!;
    expect(pick.label).toBe("BOS -5");
    expect(pick.offers).toHaveLength(2);
    expect(buildGamePick(game, odds, "moneyline_home", "test")!.offers).toHaveLength(1);
  });

  it("summarizes prop markets around the most common line", () => {
    const props = [
      { id: 1, game_id: 9, player_id: 7, vendor: "fanduel", prop_type: "points", line_value: "24.5", market: { type: "over_under", over_odds: -115, under_odds: -105 } },
      { id: 2, game_id: 9, player_id: 7, vendor: "draftkings", prop_type: "points", line_value: "24.5", market: { type: "over_under", over_odds: -105, under_odds: -115 } },
      { id: 3, game_id: 9, player_id: 7, vendor: "caesars", prop_type: "points", line_value: "25.5", market: { type: "over_under", over_odds: 110, under_odds: -140 } },
      { id: 4, game_id: 9, player_id: 7, vendor: "caesars", prop_type: "points", line_value: "30", market: { type: "milestone", odds: 300 } },
    ] as BdlPlayerProp[];
    const [summary] = summarizePropMarkets(props);
    expect(summary.mainLine).toBe(24.5);
    expect(summary.bestOver).toEqual({ vendor: "draftkings", odds: -105, line: 24.5 });
    expect(summary.vendorCount).toBe(3);
    const pick = buildPropPick(game, 7, "Test Player", "points", "over", props, odds, "test", 0.55)!;
    expect(pick.label).toBe("Test Player Over 24.5 Points");
    expect(pick.offers).toHaveLength(3);
    expect(pick.offers.find((offer) => offer.vendor === "fanduel")?.eventDeeplinks).toBeNull();
    expect(mostCommonLine([1.5, 2.5, 2.5])).toBe(2.5);
  });

  it("keeps every alternate line and milestone", () => {
    const props = [
      { id: 1, game_id: 9, player_id: 7, vendor: "fanduel", prop_type: "points", line_value: "24.5", market: { type: "over_under", over_odds: -115, under_odds: -105 } },
      { id: 2, game_id: 9, player_id: 7, vendor: "draftkings", prop_type: "points", line_value: "24.5", market: { type: "over_under", over_odds: -105, under_odds: -115 } },
      { id: 3, game_id: 9, player_id: 7, vendor: "draftkings", prop_type: "points", line_value: "27.5", market: { type: "over_under", over_odds: 150, under_odds: -190 } },
      { id: 4, game_id: 9, player_id: 7, vendor: "caesars", prop_type: "points", line_value: "30", market: { type: "milestone", odds: 300 } },
      { id: 5, game_id: 9, player_id: 7, vendor: "betrivers", prop_type: "points", line_value: "30", market: { type: "milestone", odds: 320 } },
    ] as BdlPlayerProp[];
    const [summary] = summarizePropMarkets(props);
    expect(summary.ladder.map((rung) => rung.line)).toEqual([24.5, 27.5]);
    expect(summary.ladder[1].bestOver).toEqual({ vendor: "draftkings", odds: 150 });
    expect(summary.milestones).toEqual([{ threshold: 30, best: { vendor: "betrivers", odds: 320 }, books: 2 }]);
    const altPick = buildPropPick(game, 7, "Test Player", "points", "over", props, odds, "test", 0.3, 27.5)!;
    expect(altPick.label).toBe("Test Player Over 27.5 Points");
    expect(altPick.offers).toHaveLength(1);
    expect(altPick.pickId).toContain("27.5");
    const milestonePick = buildMilestonePick(game, 7, "Test Player", "points", 30, props, odds, "test")!;
    expect(milestonePick.label).toBe("Test Player 30+ Points");
    expect(milestonePick.offers.map((offer) => offer.lineValue)).toEqual([29.5, 29.5]);
  });
});
