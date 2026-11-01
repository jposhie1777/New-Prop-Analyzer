import { readFileSync } from "node:fs";
import { buildGameBox } from "../src/lib/ncaab/boxScore";
import type { NcaabGame, NcaabPlay } from "../src/lib/ncaab/types";

const samples = JSON.parse(readFileSync("check/sample-games.json", "utf8")) as Array<{ group: string; game: NcaabGame }>;
const results = new Map<string, { games: number; match: number; close: number }>();
const misses: string[] = [];
for (const { group, game } of samples) {
  const response = await fetch(`https://api.balldontlie.io/ncaab/v1/plays?game_id=${game.id}&per_page=100`, { headers: { Authorization: process.env.BDL_API_KEY ?? "" } });
  const plays = ((await response.json()) as { data: NcaabPlay[] }).data ?? [];
  const box = buildGameBox(game, plays);
  const tally = results.get(group) ?? { games: 0, match: 0, close: 0 };
  tally.games += 1;
  if (box.quality.pointsMatch) tally.match += 1;
  else if (Math.abs(box.home.points - game.home_score!) + Math.abs(box.away.points - game.away_score!) <= 4) tally.close += 1;
  results.set(group, tally);
  if (!box.quality.pointsMatch) misses.push(`${game.id}: final ${game.home_score}-${game.away_score}, box ${box.home.points}-${box.away.points}, plays ${plays.length}, dupes ${box.quality.duplicatesRemoved}, unparsed ${box.quality.unparsedPlays}, last "${plays.at(-1)?.text}"`);
  if (group === "zero" && results.get(group)!.games === 1) console.log("example players:", box.players.slice(0, 5).map((line) => `${line.name} ${line.points}p ${line.offensiveRebounds + line.defensiveRebounds}r ${line.assists}a ${line.fieldGoalsMade}-${line.fieldGoalsAttempted}`).join(" | "));
}
console.log(Object.fromEntries(results));
console.log(misses.join("\n"));
