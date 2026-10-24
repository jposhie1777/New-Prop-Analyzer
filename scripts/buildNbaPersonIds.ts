import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeAnalyticsEngine } from "../src/lib/analytics/nodeEngine";
import { teamById } from "../src/lib/nba/teams";
import type { BaselineManifest } from "../src/lib/data/manifest";
import { normalizePersonName } from "../src/lib/nba/personNames";
import { loadEnvironmentFiles } from "./loadEnvironment";

interface NbaPerson {
  personId: number;
  firstName: string;
  lastName: string;
  teamAbbreviation: string;
}

interface BdlPlayerRow {
  player_id: number;
  first_name: string;
  last_name: string;
  team_id: number | null;
}

const browserHeaders = { "User-Agent": "Mozilla/5.0 (personal non-commercial project)", Referer: "https://www.nba.com/", Origin: "https://www.nba.com", Accept: "application/json" };

function seasonLabel(seasonStartYear: number): string {
  return `${seasonStartYear}-${String((seasonStartYear + 1) % 100).padStart(2, "0")}`; // 2026 -> 2026-27
}

async function fetchJson(targetUrl: string): Promise<unknown> {
  const response = await fetch(targetUrl, { headers: browserHeaders, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(targetUrl).host}`);
  return response.json();
}

async function peopleFromPlayerIndex(seasonStartYear: number): Promise<NbaPerson[]> {
  const indexUrl = `https://stats.nba.com/stats/playerindex?Historical=0&LeagueID=00&Season=${seasonLabel(seasonStartYear)}&SeasonType=Regular%20Season&TeamID=0&College=&Country=&DraftPick=&DraftRound=&DraftYear=&Height=&Weight=`;
  const payload = (await fetchJson(indexUrl)) as { resultSets: Array<{ headers: string[]; rowSet: unknown[][] }> };
  const resultSet = payload.resultSets[0];
  const columnIndex = (columnName: string) => resultSet.headers.indexOf(columnName);
  return resultSet.rowSet.map((rowValues) => ({
    personId: Number(rowValues[columnIndex("PERSON_ID")]),
    firstName: String(rowValues[columnIndex("PLAYER_FIRST_NAME")] ?? ""),
    lastName: String(rowValues[columnIndex("PLAYER_LAST_NAME")] ?? ""),
    teamAbbreviation: String(rowValues[columnIndex("TEAM_ABBREVIATION")] ?? ""),
  }));
}

async function peopleFromLiveBoxScores(): Promise<NbaPerson[]> {
  const schedule = (await fetchJson("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json")) as {
    leagueSchedule: { gameDates: Array<{ games: Array<{ gameId: string; gameStatus: number; homeTeam: { teamTricode: string }; awayTeam: { teamTricode: string } }> }> };
  };
  const finishedGames = schedule.leagueSchedule.gameDates.flatMap((gameDate) => gameDate.games).filter((game) => game.gameStatus === 3);
  const latestGameByTeam = new Map<string, string>();
  for (const game of finishedGames) {
    latestGameByTeam.set(game.homeTeam.teamTricode, game.gameId); // later games overwrite, leaving each team's latest
    latestGameByTeam.set(game.awayTeam.teamTricode, game.gameId);
  }
  const people = new Map<number, NbaPerson>();
  for (const gameId of new Set(latestGameByTeam.values())) {
    try {
      const boxScore = (await fetchJson(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`)) as {
        game: Record<"homeTeam" | "awayTeam", { teamTricode: string; players: Array<{ personId: number; firstName: string; familyName: string }> }>;
      };
      for (const side of [boxScore.game.homeTeam, boxScore.game.awayTeam]) {
        for (const boxPlayer of side.players) people.set(boxPlayer.personId, { personId: boxPlayer.personId, firstName: boxPlayer.firstName, lastName: boxPlayer.familyName, teamAbbreviation: side.teamTricode });
      }
    } catch {
      continue; // one missing box score should not stop the mapping
    }
  }
  return [...people.values()];
}

async function loadBdlPlayers(outputDirectory: string): Promise<BdlPlayerRow[]> {
  const manifestPath = join(outputDirectory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("no baseline manifest yet, run npm run baseline first");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BaselineManifest;
  const playerFiles = Object.values(manifest.seasons).map((seasonEntry) => seasonEntry.tables.players?.file).filter((file): file is string => Boolean(file));
  if (playerFiles.length === 0) return [];
  const engine = await NodeAnalyticsEngine.create();
  try {
    const fileList = playerFiles.map((file) => `'${resolve(outputDirectory, file).replace(/'/g, "''")}'`).join(", ");
    return await engine.query<BdlPlayerRow>(`SELECT player_id, first_name, last_name, team_id FROM read_parquet([${fileList}]) QUALIFY ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY last_seen_date DESC) = 1`);
  } finally {
    engine.close();
  }
}

export function matchPeople(bdlPlayers: BdlPlayerRow[], people: NbaPerson[]): Record<string, number> {
  const byNameAndTeam = new Map<string, number>();
  const byName = new Map<string, number[]>();
  for (const person of people) {
    const nameKey = normalizePersonName(`${person.firstName} ${person.lastName}`);
    byNameAndTeam.set(`${nameKey}|${person.teamAbbreviation.toUpperCase()}`, person.personId);
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), person.personId]);
  }
  const mapping: Record<string, number> = {};
  for (const bdlPlayer of bdlPlayers) {
    const nameKey = normalizePersonName(`${bdlPlayer.first_name} ${bdlPlayer.last_name}`);
    const abbreviation = bdlPlayer.team_id ? (teamById(bdlPlayer.team_id)?.abbreviation ?? "") : "";
    const teamMatch = byNameAndTeam.get(`${nameKey}|${abbreviation}`);
    const nameMatches = [...new Set(byName.get(nameKey) ?? [])];
    if (teamMatch) mapping[String(bdlPlayer.player_id)] = teamMatch; // name + team is the strongest match
    else if (nameMatches.length === 1) mapping[String(bdlPlayer.player_id)] = nameMatches[0]; // traded players: unique name is enough
  }
  return mapping;
}

export async function buildNbaPersonIds(options: { outputDirectory: string; quiet: boolean }): Promise<void> {
  if (options.outputDirectory.includes("mock-baseline")) {
    console.log("image mapping skipped in mock mode (mock players are not real people)");
    return;
  }
  const bdlPlayers = await loadBdlPlayers(options.outputDirectory);
  const people: NbaPerson[] = [];
  for (const seasonStartYear of [2026, 2025]) {
    try {
      people.push(...(await peopleFromPlayerIndex(seasonStartYear)));
    } catch (caughtError) {
      if (!options.quiet) console.log(`stats.nba.com player index unavailable for ${seasonLabel(seasonStartYear)}: ${caughtError instanceof Error ? caughtError.message : "error"}`);
    }
  }
  if (people.length === 0) people.push(...(await peopleFromLiveBoxScores()));
  const mapping = matchPeople(bdlPlayers, people);
  const targetPath = resolve("public", "data", "nba-person-ids.json");
  writeFileSync(targetPath, JSON.stringify({ generatedAt: new Date().toISOString(), source: "nba.com", matched: Object.keys(mapping).length, total: bdlPlayers.length, ids: mapping }));
  console.log(`headshot mapping: matched ${Object.keys(mapping).length}/${bdlPlayers.length} players -> public/data/nba-person-ids.json (add fixes to src/config/nbaPersonOverrides.json)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadEnvironmentFiles();
  const tierName = (process.env.BDL_TIER ?? "mock").toLowerCase();
  buildNbaPersonIds({ outputDirectory: resolve("public", "data", tierName === "mock" ? "mock-baseline" : "baseline"), quiet: false }).catch((caughtError) => {
    console.error(caughtError instanceof Error ? caughtError.message : caughtError);
    process.exit(1);
  });
}
