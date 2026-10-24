import { describe, expect, it } from "vitest";
import { matchPeople } from "../scripts/buildNbaPersonIds";
import { initialsFor, normalizePersonName } from "@/lib/nba/personNames";

describe("NBA person id mapping", () => {
  it("normalizes accents and suffixes", () => {
    expect(normalizePersonName("Nikola Jokić")).toBe("nikolajokic");
    expect(normalizePersonName("Jaren Jackson Jr.")).toBe("jarenjackson");
    expect(initialsFor("LeBron", "James")).toBe("LJ");
  });

  it("matches by name and team, then by unique name", () => {
    const bdlPlayers = [
      { player_id: 1, first_name: "Nikola", last_name: "Jokic", team_id: 8 },
      { player_id: 2, first_name: "Traded", last_name: "Guy", team_id: 2 },
      { player_id: 3, first_name: "Common", last_name: "Name", team_id: 5 },
    ];
    const people = [
      { personId: 203999, firstName: "Nikola", lastName: "Jokić", teamAbbreviation: "DEN" },
      { personId: 111, firstName: "Traded", lastName: "Guy", teamAbbreviation: "LAL" },
      { personId: 222, firstName: "Common", lastName: "Name", teamAbbreviation: "ATL" },
      { personId: 333, firstName: "Common", lastName: "Name", teamAbbreviation: "MIA" },
    ];
    expect(matchPeople(bdlPlayers, people)).toEqual({ "1": 203999, "2": 111 }); // ambiguous names stay unmapped and fall back to initials
  });
});
