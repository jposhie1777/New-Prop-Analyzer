import { describe, expect, it } from "vitest";
import { selectedOffer, type SlipPick } from "@/lib/client/betSlip";
import { bookHomeLink } from "@/lib/odds/deeplinks";

const pick = {
  pickId: "p1", kind: "prop", gameId: 1, gameDate: "2026-10-25", market: "prop", selectionKey: "over", label: "Julius Randle Over 1.5 3PM", detail: "BKN @ CLE",
  propType: "threes", playerId: 3, modelProbability: 0.6, source: "live", addedAt: "",
  offers: [
    { vendor: "draftkings", americanOdds: 110, lineValue: 1.5, deeplinks: null, eventDeeplinks: null },
    { vendor: "fanduel", americanOdds: -108, lineValue: 1.5, deeplinks: null, eventDeeplinks: null },
  ],
} as SlipPick;

describe("slip book choice", () => {
  it("uses the chosen book, then the default book, then the best price", () => {
    expect(selectedOffer(pick, "")?.vendor).toBe("draftkings");
    expect(selectedOffer(pick, "fanduel")?.vendor).toBe("fanduel");
    expect(selectedOffer({ ...pick, chosenVendor: "draftkings" }, "fanduel")?.vendor).toBe("draftkings");
    expect(selectedOffer(pick, "betmgm")?.vendor).toBe("draftkings"); // default book doesn't offer it
  });

  it("falls back to the book's NBA page with the state filled in", () => {
    expect(bookHomeLink("betmgm", { sportsbookState: "nj", wagerAmount: 10, pickType: "single" })).toEqual({ href: "https://sports.nj.betmgm.com/en/sports/basketball-7/betting/usa-9/nba-6004", kind: "book" });
    expect(bookHomeLink("unknownbook", { sportsbookState: "nj", wagerAmount: 10, pickType: "single" })).toBeNull();
  });
});
