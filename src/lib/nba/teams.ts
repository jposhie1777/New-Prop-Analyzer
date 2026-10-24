import type { BdlTeam } from "@/lib/bdl/types";

export interface TeamReference extends BdlTeam {
  nbaTeamId: number;
}

const teamRows: Array<[number, string, string, string, string, string, number]> = [
  [1, "ATL", "Atlanta", "Hawks", "East", "Southeast", 1610612737],
  [2, "BOS", "Boston", "Celtics", "East", "Atlantic", 1610612738],
  [3, "BKN", "Brooklyn", "Nets", "East", "Atlantic", 1610612751],
  [4, "CHA", "Charlotte", "Hornets", "East", "Southeast", 1610612766],
  [5, "CHI", "Chicago", "Bulls", "East", "Central", 1610612741],
  [6, "CLE", "Cleveland", "Cavaliers", "East", "Central", 1610612739],
  [7, "DAL", "Dallas", "Mavericks", "West", "Southwest", 1610612742],
  [8, "DEN", "Denver", "Nuggets", "West", "Northwest", 1610612743],
  [9, "DET", "Detroit", "Pistons", "East", "Central", 1610612765],
  [10, "GSW", "Golden State", "Warriors", "West", "Pacific", 1610612744],
  [11, "HOU", "Houston", "Rockets", "West", "Southwest", 1610612745],
  [12, "IND", "Indiana", "Pacers", "East", "Central", 1610612754],
  [13, "LAC", "LA", "Clippers", "West", "Pacific", 1610612746],
  [14, "LAL", "Los Angeles", "Lakers", "West", "Pacific", 1610612747],
  [15, "MEM", "Memphis", "Grizzlies", "West", "Southwest", 1610612763],
  [16, "MIA", "Miami", "Heat", "East", "Southeast", 1610612748],
  [17, "MIL", "Milwaukee", "Bucks", "East", "Central", 1610612749],
  [18, "MIN", "Minnesota", "Timberwolves", "West", "Northwest", 1610612750],
  [19, "NOP", "New Orleans", "Pelicans", "West", "Southwest", 1610612740],
  [20, "NYK", "New York", "Knicks", "East", "Atlantic", 1610612752],
  [21, "OKC", "Oklahoma City", "Thunder", "West", "Northwest", 1610612760],
  [22, "ORL", "Orlando", "Magic", "East", "Southeast", 1610612753],
  [23, "PHI", "Philadelphia", "76ers", "East", "Atlantic", 1610612755],
  [24, "PHX", "Phoenix", "Suns", "West", "Pacific", 1610612756],
  [25, "POR", "Portland", "Trail Blazers", "West", "Northwest", 1610612757],
  [26, "SAC", "Sacramento", "Kings", "West", "Pacific", 1610612758],
  [27, "SAS", "San Antonio", "Spurs", "West", "Southwest", 1610612759],
  [28, "TOR", "Toronto", "Raptors", "East", "Atlantic", 1610612761],
  [29, "UTA", "Utah", "Jazz", "West", "Northwest", 1610612762],
  [30, "WAS", "Washington", "Wizards", "East", "Southeast", 1610612764],
];

export const teamReferences: TeamReference[] = teamRows.map(([teamId, abbreviation, city, name, conference, division, nbaTeamId]) => ({
  id: teamId,
  abbreviation,
  city,
  name,
  full_name: `${city} ${name}`,
  conference,
  division,
  nbaTeamId,
}));

const teamsById = new Map(teamReferences.map((team) => [team.id, team]));
const teamsByAbbreviation = new Map(teamReferences.map((team) => [team.abbreviation, team]));

export function teamById(teamId: number): TeamReference | undefined {
  return teamsById.get(teamId);
}

export function teamByAbbreviation(abbreviation: string): TeamReference | undefined {
  return teamsByAbbreviation.get(abbreviation.toUpperCase());
}

export function teamLogoUrl(teamId: number): string | null {
  const team = teamsById.get(teamId);
  return team ? `https://cdn.nba.com/logos/nba/${team.nbaTeamId}/global/L/logo.svg` : null; // NBA's public logo CDN
}

export function bdlTeam(teamId: number): BdlTeam {
  const team = teamsById.get(teamId);
  if (!team) throw new Error(`unknown team ${teamId}`);
  const { nbaTeamId: _unusedNbaId, ...bdlShape } = team;
  return bdlShape;
}
