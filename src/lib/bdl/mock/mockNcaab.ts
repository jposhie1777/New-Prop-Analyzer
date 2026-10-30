import type { QueryParams } from "@/lib/bdl/bdlClient";
import type { NcaabGame, NcaabPlay, NcaabPlayer, NcaabRanking, NcaabTeam } from "@/lib/ncaab/types";
import { addDays, todayEastern } from "@/lib/dates";

const schools: Array<[string, string, string, number]> = [
  ["Duke", "Blue Devils", "DUKE", 1],
  ["North Carolina", "Tar Heels", "UNC", 1],
  ["Virginia", "Cavaliers", "UVA", 1],
  ["Louisville", "Cardinals", "LOU", 1],
  ["Clemson", "Tigers", "CLEM", 1],
  ["Miami", "Hurricanes", "MIA", 1],
  ["Wake Forest", "Demon Deacons", "WAKE", 1],
  ["Syracuse", "Orange", "SYR", 1],
  ["Kansas", "Jayhawks", "KU", 2],
  ["Houston", "Cougars", "HOU", 2],
  ["Baylor", "Bears", "BAY", 2],
  ["Iowa State", "Cyclones", "ISU", 2],
  ["Texas Tech", "Red Raiders", "TTU", 2],
  ["Arizona", "Wildcats", "ARIZ", 2],
  ["BYU", "Cougars", "BYU", 2],
  ["Cincinnati", "Bearcats", "CIN", 2],
  ["Kentucky", "Wildcats", "UK", 3],
  ["Auburn", "Tigers", "AUB", 3],
  ["Alabama", "Crimson Tide", "BAMA", 3],
  ["Tennessee", "Volunteers", "TENN", 3],
  ["Florida", "Gators", "FLA", 3],
  ["Arkansas", "Razorbacks", "ARK", 3],
  ["Texas A&M", "Aggies", "TAMU", 3],
  ["Ole Miss", "Rebels", "MISS", 3],
];

const firstNames = ["Jalen", "Cooper", "Tyrese", "Marcus", "Isaiah", "Caleb", "Darius", "Jordan", "Malik", "Trey", "Cameron", "Elijah", "Josh", "Kon", "Mason"];
const lastNames = ["Flagg", "Proctor", "Knueppel", "Maluach", "Foster", "Evans", "Johnson", "Walker", "Brooks", "Carter", "Hayes", "Mitchell", "Reed", "Sanders", "Ward"];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export const mockNcaabTeams: NcaabTeam[] = schools.map(([college, name, abbreviation, conferenceId], teamIndex) => ({ id: teamIndex + 1, conference_id: conferenceId, name, full_name: `${college} ${name}`, college, abbreviation }));
const teamStrength = new Map(mockNcaabTeams.map((team) => [team.id, seeded(team.id * 97)() * 20 - 8])); // points better than average

function rosterFor(teamId: number): NcaabPlayer[] {
  const random = seeded(teamId * 131);
  return Array.from({ length: 9 }, (_, playerIndex) => ({ id: teamId * 100 + playerIndex, first_name: firstNames[Math.floor(random() * firstNames.length)], last_name: `${lastNames[Math.floor(random() * lastNames.length)]}${playerIndex > 4 ? " Jr." : ""}`, position: playerIndex < 2 ? "G" : playerIndex < 5 ? "F" : "C", team: mockNcaabTeams[teamId - 1] }));
}

function seasonFor(isoDate: string): number {
  const [year, month] = isoDate.split("-").map(Number);
  return month >= 10 ? year : year - 1;
}

function seasonDates(season: number): string[] {
  const today = todayEastern();
  const start = season === seasonFor(today) ? addDays(today, -6) : `${season}-11-04`; // this season: a few finished days, today and the next few
  const end = season === seasonFor(today) ? addDays(today, 3) : `${season + 1}-03-08`;
  const dates: string[] = [];
  for (let isoDate = start; isoDate <= end; isoDate = addDays(isoDate, 2)) dates.push(isoDate);
  return dates;
}

function gamesOn(isoDate: string): NcaabGame[] {
  const season = seasonFor(isoDate);
  const random = seeded(Number(isoDate.replace(/-/g, "")));
  const order = [...mockNcaabTeams].sort(() => random() - 0.5);
  const today = todayEastern();
  return Array.from({ length: 6 }, (_, gameIndex) => {
    const home = order[gameIndex * 2];
    const visitor = order[gameIndex * 2 + 1];
    const gameId = Number(`${isoDate.replace(/-/g, "").slice(2)}${gameIndex}`);
    const hourUtc = 23 + (gameIndex % 3);
    const tip = `${hourUtc >= 24 ? addDays(isoDate, 1) : isoDate}T${String(hourUtc % 24).padStart(2, "0")}:00:00.000Z`; // evening Eastern tips land after midnight UTC
    const final = isoDate < today;
    const scoreRandom = seeded(gameId);
    const homeScore = Math.round(72 + (teamStrength.get(home.id)! - teamStrength.get(visitor.id)!) / 2 + 2 + (scoreRandom() - 0.5) * 22);
    const awayScore = Math.round(70 + (teamStrength.get(visitor.id)! - teamStrength.get(home.id)!) / 2 + (scoreRandom() - 0.5) * 22);
    return { id: gameId, date: tip, season, postseason: false, status: final ? "Final" : "Scheduled", status_state: final ? "final" : "scheduled", period: final ? 2 : 0, period_detail: final ? "Final" : null, home_team: home, visitor_team: visitor, home_score: final ? homeScore : null, away_score: final ? Math.max(40, awayScore === homeScore ? awayScore - 1 : awayScore) : null };
  });
}

function allGames(seasons: number[]): NcaabGame[] {
  return seasons.flatMap((season) => seasonDates(season).flatMap(gamesOn));
}

function findGame(gameId: number): NcaabGame | null {
  const text = String(gameId);
  const isoDate = `20${text.slice(0, 2)}-${text.slice(2, 4)}-${text.slice(4, 6)}`;
  return gamesOn(isoDate).find((game) => game.id === gameId) ?? null;
}

function playsFor(game: NcaabGame): NcaabPlay[] {
  if (game.status_state !== "final") return [];
  const random = seeded(game.id * 7);
  const plays: NcaabPlay[] = [];
  let homeScore = 0;
  let awayScore = 0;
  const push = (text: string, teamId: number | null, value = 0) => {
    if (teamId === game.home_team.id) homeScore += value;
    else if (teamId === game.visitor_team.id) awayScore += value;
    plays.push({ game_id: game.id, order: plays.length + 1, type: null, text, home_score: homeScore, away_score: awayScore, period: plays.length < 140 ? 1 : 2, clock: null, scoring_play: value > 0, score_value: value || null, team: teamId === null ? null : { id: teamId } });
  };
  const sides = [
    { team: game.home_team, target: game.home_score ?? 0 },
    { team: game.visitor_team, target: game.away_score ?? 0 },
  ];
  for (let possession = 0; possession < 140; possession++) {
    const side = sides[possession % 2];
    const defense = sides[(possession + 1) % 2];
    const roster = rosterFor(side.team.id);
    const shooter = roster[Math.floor(random() * 7)];
    const shooterName = `${shooter.first_name} ${shooter.last_name}`;
    const scored = side.team.id === game.home_team.id ? homeScore : awayScore;
    if (random() < 0.13) {
      push(`${shooterName} Turnover.`, side.team.id);
      push(`${rosterFor(defense.team.id)[0].first_name} ${rosterFor(defense.team.id)[0].last_name} Steal.`, defense.team.id);
      continue;
    }
    const remaining = side.target - scored;
    const three = random() < 0.35;
    const value = three ? 3 : 2;
    if (remaining >= value && random() < 0.55) {
      const assister = roster[(roster.indexOf(shooter) + 1) % 7];
      push(`${shooterName} made ${three ? "Three Point Jumper" : "Layup"}. Assisted by ${assister.first_name} ${assister.last_name}.`, side.team.id, value);
    } else {
      push(`${shooterName} missed ${three ? "Three Point Jumper" : "Jumper"}.`, side.team.id);
      const offensive = random() < 0.28;
      const rebounder = offensive ? roster[Math.floor(random() * 9)] : rosterFor(defense.team.id)[Math.floor(random() * 9)];
      push(`${rebounder.first_name} ${rebounder.last_name} ${offensive ? "Offensive" : "Defensive"} Rebound.`, offensive ? side.team.id : defense.team.id);
    }
  }
  for (const side of sides) {
    const roster = rosterFor(side.team.id);
    while ((side.team.id === game.home_team.id ? homeScore : awayScore) < side.target) {
      const shooter = roster[Math.floor(random() * 5)];
      push(`${shooter.first_name} ${shooter.last_name} made Free Throw.`, side.team.id, 1); // free throws close any gap to the final score
    }
  }
  return plays;
}

function paginate<ItemType>(items: ItemType[], params: QueryParams) {
  const perPage = Math.min(100, Number(params.per_page ?? 25) || 25);
  const offset = Number(params.cursor ?? 0) || 0;
  return { data: items.slice(offset, offset + perPage), meta: { per_page: perPage, next_cursor: offset + perPage < items.length ? offset + perPage : null } };
}

function listParam(params: QueryParams, name: string): string[] {
  const raw = params[name];
  if (raw === undefined || raw === null || raw === "") return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

export function handleMockNcaab(path: string, params: QueryParams): unknown {
  switch (path) {
    case "/ncaab/v1/teams":
      return paginate(mockNcaabTeams, params);
    case "/ncaab/v1/conferences":
      return { data: [{ id: 1, name: "Atlantic Coast Conference", short_name: "ACC" }, { id: 2, name: "Big 12 Conference", short_name: "Big 12" }, { id: 3, name: "Southeastern Conference", short_name: "SEC" }] };
    case "/ncaab/v1/players/active":
      return paginate(mockNcaabTeams.flatMap((team) => rosterFor(team.id)), params);
    case "/ncaab/v1/games": {
      const dates = listParam(params, "dates[]");
      const seasons = listParam(params, "seasons[]").map(Number);
      const games = dates.length > 0 ? dates.filter((isoDate) => seasonDates(seasonFor(isoDate)).includes(isoDate)).flatMap(gamesOn) : allGames(seasons.length > 0 ? seasons : [seasonFor(todayEastern())]);
      return paginate(games, params);
    }
    case "/ncaab/v1/plays": {
      const game = findGame(Number(params.game_id));
      return { data: game ? playsFor(game) : [] };
    }
    case "/ncaab/v1/rankings": {
      const season = Number(params.season ?? seasonFor(todayEastern()));
      const ranked = [...mockNcaabTeams].sort((first, second) => teamStrength.get(second.id)! - teamStrength.get(first.id)!).slice(0, 25);
      const rankings: NcaabRanking[] = ranked.map((team, rankIndex) => ({ poll_id: "ap", team, season, week: 1, rank: rankIndex + 1, first_place_votes: rankIndex === 0 ? 40 : 0, trend: "-", points: 1500 - rankIndex * 55, record: "0-0" }));
      return paginate(rankings, params);
    }
    default:
      throw new Error(`mock mode has no fixture for ${path}`);
  }
}

export function mockNcaabOdds(isoDate: string): unknown[] {
  return gamesOn(isoDate)
    .filter((game) => game.status_state !== "final")
    .map((game) => {
      const random = seeded(game.id * 13);
      const margin = (teamStrength.get(game.home_team.id)! - teamStrength.get(game.visitor_team.id)!) / 2 + 3;
      const spread = Math.round((-margin + (random() - 0.5) * 3) * 2) / 2;
      const total = Math.round((142 + (random() - 0.5) * 8) * 2) / 2;
      const homeProbability = 1 / (1 + Math.exp(-margin / 6));
      const moneyline = (probability: number) => (probability >= 0.5 ? -Math.round((probability / (1 - probability)) * 100 * 1.04) : Math.round(((1 - probability) / probability) * 100 * 0.96));
      return {
        id: `mock-${game.id}`,
        sport_key: "basketball_ncaab",
        commence_time: game.date,
        home_team: game.home_team.full_name,
        away_team: game.visitor_team.full_name,
        bookmakers: ["draftkings", "fanduel", "betmgm"].map((key, bookIndex) => ({
          key,
          title: key,
          last_update: new Date().toISOString(),
          markets: [
            { key: "h2h", outcomes: [{ name: game.home_team.full_name, price: moneyline(homeProbability) }, { name: game.visitor_team.full_name, price: moneyline(1 - homeProbability) }] },
            { key: "spreads", outcomes: [{ name: game.home_team.full_name, price: -110 + bookIndex * 2, point: spread }, { name: game.visitor_team.full_name, price: -110 - bookIndex * 2, point: -spread }] },
            { key: "totals", outcomes: [{ name: "Over", price: -110, point: total + (bookIndex === 1 ? 0.5 : 0) }, { name: "Under", price: -110, point: total + (bookIndex === 1 ? 0.5 : 0) }] },
          ],
        })),
      };
    });
}
