import { describe, expect, it } from "vitest";
import { booksKey, filterByBooks, isBookEnabled } from "@/lib/client/bookFilter";

describe("sportsbook filter", () => {
  const offers = [{ vendor: "fanduel" }, { vendor: "draftkings" }, { vendor: "caesars" }];

  it("keeps every book when none are chosen", () => {
    expect(filterByBooks(offers, [])).toHaveLength(3);
    expect(isBookEnabled("betmgm", [])).toBe(true);
    expect(booksKey([])).toBe("all");
  });

  it("keeps only chosen books", () => {
    expect(filterByBooks(offers, ["fanduel", "caesars"]).map((offer) => offer.vendor)).toEqual(["fanduel", "caesars"]);
    expect(isBookEnabled("draftkings", ["fanduel"])).toBe(false);
    expect(booksKey(["fanduel", "caesars"])).toBe("caesars+fanduel");
  });
});
