export const appSettings = {
  defaultSportsbookState: "nj", // fills {state} in BDL deeplink templates
  defaultEvThresholdPercent: 3, // halftime picks at or above this EV are flagged
  defaultWagerAmount: 10, // fills {wagerAmount} in BetRivers coupon templates
  defaultPickType: "single", // fills {pickType} in BetRivers coupon templates, verify against a real link
  livePollIntervalMs: 30_000, // live box scores while a game is in progress
  slatePollIntervalMs: 600_000, // slate and opening lines
  currentSeason: 2026, // BDL season = start year, 2026-27
  lastSeason: 2025,
  timeZone: "America/New_York", // NBA dates are Eastern
  hundredThroughThreeTarget: 100, // the 100-in-3-quarters threshold
  hundredThroughThreeBaseRate: 0.13, // share of team-games with 100+ through three quarters in 2025-26
  defaultThreeQuarterMinimumPercent: 20, // rating needed for a 100-in-3 recommendation
  defaultThreeQuarterMaxPicks: 4, // recommendations per day
  defaultTeamThreeQuarterSd: 9, // fallback standard deviation of Q1-Q3 points when history is thin
  blowoutMargin: 20, // halftime margin treated as a blowout
  blowoutWarningMargin: 15, // live margin that shows the potential blowout warning
  kellyFraction: 0.25, // fractional Kelly
};
