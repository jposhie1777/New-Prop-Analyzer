import { describe, expect, it } from "vitest";
import { buildGameBox, normalizeName } from "@/lib/ncaab/boxScore";
import { adjustedRatings, blendRatings, leagueAverages, projectNcaabGame, returningShares } from "@/lib/ncaab/ratings";
import { eventToBettingOdds, matchOddsEvents, teamNameKey, type OddsApiEvent } from "@/lib/ncaab/lines";
import { ncaabSeasonFor, type NcaabGame, type NcaabPlay, type NcaabTeam } from "@/lib/ncaab/types";
import { playerAverages } from "@/lib/ncaab/dataFiles";

const duke: NcaabTeam = { id: 1, conference_id: 1, name: "Blue Devils", full_name: "Duke Blue Devils", college: "Duke", abbreviation: "DUKE" };
const stJohns: NcaabTeam = { id: 2, conference_id: 2, name: "Red Storm", full_name: "St. John's Red Storm", college: "St. John's", abbreviation: "SJU" };

function gameOf(homeScore: number, awayScore: number, overrides: Partial<NcaabGame> = {}): NcaabGame {
  return { id: 900, date: "2026-01-10T00:00:00.000Z", season: 2025, postseason: false, status: "Final", status_state: "final", period: 2, home_team: duke, visitor_team: stJohns, home_score: homeScore, away_score: awayScore, ...overrides };
}

function playsOf(rows: Array<[string, number | null, number, number]>): NcaabPlay[] {
  return rows.map(([text, teamId, homeScore, awayScore], index) => ({ game_id: 900, order: index + 1, type: null, text, home_score: homeScore, away_score: awayScore, period: 1, clock: null, scoring_play: null, score_value: null, team: teamId === null ? null : { id: teamId } }));
}

describe("NCAAB box score from play-by-play", () => {
  const plays = playsOf([
    ["Cooper Flagg made Three Point Jumper. Assisted by Tyrese Proctor.", 1, 3, 0],
    ["RJ Luis Jr. missed Jumper.", 2, 3, 0],
    ["Cooper Flagg Defensive Rebound.", 1, 3, 0],
    ["Tyrese Proctor Turnover.", 1, 3, 0],
    ["Zuby Ejiofor Steal.", 2, 3, 0],
    ["Zuby Ejiofor made Layup.", null, 3, 2], // no team on the play: the score change says who
    ["Foul on Kon Knueppel.", 1, 3, 2],
    ["RJ Luis Jr. made Free Throw.", 2, 3, 3],
    ["RJ Luis Jr. missed Free Throw.", 2, 3, 3],
    ["St. John's Offensive Team Rebound.", 2, 3, 3],
    ["Official TV Timeout", null, 3, 3],
  ]);
  const box = buildGameBox(gameOf(3, 3), plays, new Map([["1|cooper flagg", 501], [normalizeName("RJ Luis Jr."), 777]]));

  it("adds up team shooting, rebounds and turnovers", () => {
    expect(box.home).toMatchObject({ points: 3, threesMade: 1, threesAttempted: 1, assists: 1, defensiveRebounds: 1, turnovers: 1, fouls: 1 });
    expect(box.away).toMatchObject({ points: 3, fieldGoalsMade: 1, fieldGoalsAttempted: 2, freeThrowsMade: 1, freeThrowsAttempted: 2, offensiveRebounds: 1, steals: 1 });
    expect(box.quality.pointsMatch).toBe(true);
    expect(box.quality.unparsedPlays).toBe(0);
  });

  it("credits players and matches them to the roster by name", () => {
    const flagg = box.players.find((line) => line.name === "Cooper Flagg")!;
    expect(flagg).toMatchObject({ points: 3, defensiveRebounds: 1, playerId: 501, teamId: 1 });
    expect(box.players.find((line) => line.name === "Tyrese Proctor")).toMatchObject({ assists: 1, turnovers: 1 });
    expect(box.players.find((line) => line.name === "RJ Luis Jr.")).toMatchObject({ points: 1, playerId: 777 });
    expect(box.players.some((line) => /team|st\. john/i.test(line.name))).toBe(false); // team rebounds count for the team only
  });

  it("estimates possessions as FGA - OREB + TO + 0.475 FTA", () => {
    expect(box.away.possessions).toBeCloseTo(2 - 1 + 0 + 0.475 * 2, 5);
    expect(box.home.possessions).toBeCloseTo(1 - 0 + 1, 5);
  });

  it("flags a box that does not add up to the final score", () => {
    expect(buildGameBox(gameOf(10, 3), plays).quality.pointsMatch).toBe(false);
  });
});

describe("NCAAB box score against the BALLDONTLIE docs example", () => {
  const maryland: NcaabTeam = { id: 116, conference_id: 10, name: "Terrapins", full_name: "Maryland Terrapins", college: "Maryland", abbreviation: "MD" };
  const michigan: NcaabTeam = { id: 118, conference_id: 10, name: "Wolverines", full_name: "Michigan Wolverines", college: "Michigan", abbreviation: "MICH" };
  const game = gameOf(1, 0, { id: 907, home_team: maryland, visitor_team: michigan });
  const docPlays: NcaabPlay[] = [
    { game_id: 907, order: 5, type: "MadeFreeThrow", text: "Julian Reese made Free Throw.", home_score: 1, away_score: 0, period: 1, clock: "19:35", scoring_play: true, score_value: 1, team: maryland },
    { game_id: 907, order: 6, type: "MadeFreeThrow", text: "Julian Reese missed Free Throw.", home_score: 1, away_score: 0, period: 1, clock: "19:35", scoring_play: false, score_value: 1, team: maryland },
    { game_id: 907, order: 7, type: "Defensive Rebound", text: "Danny Wolf Defensive Rebound.", home_score: 1, away_score: 0, period: 1, clock: "19:34", scoring_play: false, score_value: null, team: michigan },
    { game_id: 907, order: 8, type: "JumpShot", text: "Nimari Burnett missed Three Point Jumper.", home_score: 1, away_score: 0, period: 1, clock: "19:16", scoring_play: false, score_value: 3, team: michigan },
    { game_id: 907, order: 9, type: "Offensive Rebound", text: "Michigan Offensive Rebound.", home_score: 1, away_score: 0, period: 1, clock: "19:13", scoring_play: false, score_value: null, team: michigan },
  ];
  const box = buildGameBox(game, docPlays);

  it("parses the documented play text", () => {
    expect(box.home).toMatchObject({ points: 1, freeThrowsMade: 1, freeThrowsAttempted: 2 });
    expect(box.away).toMatchObject({ threesAttempted: 1, fieldGoalsAttempted: 1, defensiveRebounds: 1, offensiveRebounds: 1 });
    expect(box.players.map((line) => line.name).sort()).toEqual(["Danny Wolf", "Julian Reese", "Nimari Burnett"]); // "Michigan" is a team rebound
    expect(box.quality.unparsedPlays).toBe(0);
  });
});

describe("NCAAB ratings", () => {
  const makeBox = (gameId: number, homeId: number, awayId: number, homePoints: number, awayPoints: number) => ({
    gameId,
    date: "2026-01-01",
    season: 2025,
    homeTeamId: homeId,
    awayTeamId: awayId,
    home: { teamId: homeId, points: homePoints, possessions: 70 } as never,
    away: { teamId: awayId, points: awayPoints, possessions: 70 } as never,
    possessions: 70,
    players: [],
    quality: { pointsMatch: true, homePlayerPoints: homePoints, awayPlayerPoints: awayPoints, unparsedPlays: 0, totalPlays: 300 },
  });
  const boxes = [makeBox(1, 1, 2, 85, 60), makeBox(2, 2, 3, 70, 70), makeBox(3, 3, 1, 62, 80), makeBox(4, 1, 3, 90, 65)];

  it("rates the team that wins big as better on both ends", () => {
    const league = leagueAverages(boxes);
    const ratings = adjustedRatings(boxes, league);
    expect(ratings.get(1)!.offense).toBeGreaterThan(ratings.get(2)!.offense);
    expect(ratings.get(1)!.defense).toBeLessThan(ratings.get(2)!.defense);
    expect(ratings.get(1)!.games).toBe(3);
  });

  it("leans on last season early and on this season later", () => {
    const league = { efficiency: 100, tempo: 68 };
    const last = new Map([[1, { offense: 120, defense: 90, tempo: 70, games: 30 }]]);
    const fewGames = blendRatings(new Map([[1, { offense: 100, defense: 100, tempo: 68, games: 1 }]]), last, league, league, new Map([[1, 1]]), [1, 9]).get(1)!;
    const manyGames = blendRatings(new Map([[1, { offense: 100, defense: 100, tempo: 68, games: 30 }]]), last, league, league, new Map([[1, 1]]), [1, 9]).get(1)!;
    expect(fewGames.blended.offense).toBeGreaterThan(manyGames.blended.offense);
    expect(manyGames.blended.offense).toBeLessThan(103);
    expect(fewGames.prior!.offense).toBeCloseTo(100 + 20 * 0.8, 5); // full returning production carries 80%
    const unknown = blendRatings(new Map(), last, league, league, new Map(), [9]).get(9)!;
    expect(unknown.blended.offense).toBeLessThan(league.efficiency); // a team with no history starts below average
  });

  it("counts transfers as returning production for their new team", () => {
    const players = [
      { name: "Stays", teamId: 1, playerId: 10, points: 300 },
      { name: "Transfers", teamId: 2, playerId: 20, points: 200 },
      { name: "Leaves", teamId: 1, playerId: 30, points: 300 },
    ] as never[];
    const shares = returningShares(players, new Map([[10, 1], [20, 1]]));
    expect(shares.get(1)).toBeCloseTo(500 / 600, 5);
    expect(shares.get(2)).toBe(0);
  });

  it("projects home court and tempo", () => {
    const team = { offense: 105, defense: 105, tempo: 68, games: 10 };
    const league = { efficiency: 105, tempo: 68 };
    const home = projectNcaabGame(team, team, league, false);
    const neutral = projectNcaabGame(team, team, league, true);
    expect(home.margin).toBeCloseTo(3.2, 5);
    expect(neutral.margin).toBeCloseTo(0, 5);
    expect(home.total).toBeCloseTo(2 * 68 * 1.05, 5);
    expect(home.homeWinProbability).toBeGreaterThan(0.5);
  });
});

describe("NCAAB odds matching", () => {
  const game = gameOf(0, 0, { status: "Scheduled", status_state: "scheduled", home_score: null, away_score: null, date: "2026-01-10T00:00:00.000Z" });
  const event: OddsApiEvent = {
    id: "abc",
    commence_time: "2026-01-10T00:05:00Z",
    home_team: "Duke Blue Devils",
    away_team: "St John's Red Storm",
    bookmakers: [
      {
        key: "williamhill_us",
        title: "Caesars",
        last_update: "2026-01-09T20:00:00Z",
        markets: [
          { key: "h2h", outcomes: [{ name: "Duke Blue Devils", price: -250 }, { name: "St John's Red Storm", price: 205 }] },
          { key: "spreads", outcomes: [{ name: "Duke Blue Devils", price: -110, point: -6.5 }, { name: "St John's Red Storm", price: -110, point: 6.5 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -108, point: 145.5 }, { name: "Under", price: -112, point: 145.5 }] },
        ],
      },
    ],
  };

  it("normalizes school names", () => {
    expect(teamNameKey("St. John's Red Storm")).toBe(teamNameKey("Saint John's Red Storm"));
    expect(teamNameKey("Michigan State Spartans")).toBe("michigan st spartans");
  });

  it("matches events to BDL games and converts them to the BDL odds shape", () => {
    const { matched, unmatched } = matchOddsEvents([event, { ...event, id: "other", home_team: "Gonzaga Bulldogs", away_team: "Saint Mary's Gaels" }], [game]);
    expect(matched.get(900)?.id).toBe("abc");
    expect(unmatched.map((unmatchedEvent) => unmatchedEvent.id)).toEqual(["other"]);
    const [odds] = eventToBettingOdds(event, game);
    expect(odds).toMatchObject({ game_id: 900, vendor: "caesars", spread_home_value: "-6.5", spread_away_value: "6.5", moneyline_home_odds: -250, moneyline_away_odds: 205, total_value: "145.5", total_over_odds: -108, total_under_odds: -112 });
  });

  it("keeps BDL home and away when the Odds API lists a neutral game the other way round", () => {
    const swapped = { ...event, home_team: event.away_team, away_team: event.home_team };
    expect(matchOddsEvents([swapped], [game]).matched.has(900)).toBe(true);
    expect(eventToBettingOdds(swapped, game)[0]).toMatchObject({ spread_home_value: "-6.5", moneyline_home_odds: -250 });
  });
});

describe("NCAAB helpers", () => {
  it("maps dates to the season that starts in the fall", () => {
    expect(ncaabSeasonFor("2026-11-04")).toBe(2026);
    expect(ncaabSeasonFor("2027-03-20")).toBe(2026);
  });

  it("averages player lines per game", () => {
    const line = { name: "A", teamId: 1, playerId: 5, points: 20, fieldGoalsMade: 8, fieldGoalsAttempted: 16, threesMade: 2, threesAttempted: 5, freeThrowsMade: 2, freeThrowsAttempted: 2, offensiveRebounds: 1, defensiveRebounds: 4, assists: 3, turnovers: 2, steals: 1, blocks: 0, fouls: 2 };
    const [average] = playerAverages([line, { ...line, points: 10, fieldGoalsMade: 4 }], 2026);
    expect(average).toMatchObject({ games: 2, points: 15, rebounds: 5, fieldGoalPercent: 12 / 32 });
  });
});
