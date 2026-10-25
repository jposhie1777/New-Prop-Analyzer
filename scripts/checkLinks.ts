import { BdlClient } from "../src/lib/bdl/bdlClient";
import { resolveTier } from "../src/config/tiers";
import { todayEastern } from "../src/lib/dates";
import type { BdlBettingOdd, BdlGame, BdlListResponse, BdlPlayerProp } from "../src/lib/bdl/types";
import { loadEnvironmentFiles } from "./loadEnvironment";

function describeLinks(rawItem: Record<string, unknown>): string {
  const linkKeys = Object.keys(rawItem).filter((fieldName) => /link|url|deep/i.test(fieldName)); // catch any field name BDL uses for links
  if (linkKeys.length === 0) return "no link fields";
  return linkKeys.map((fieldName) => `${fieldName}=${JSON.stringify(rawItem[fieldName]).slice(0, 600)}`).join(" | ");
}

async function main(): Promise<void> {
  loadEnvironmentFiles();
  const client = new BdlClient({ tier: resolveTier(process.env.BDL_TIER), apiKey: process.env.BDL_API_KEY });
  const today = process.argv[2] ?? todayEastern();
  const games = await client.getAllPages<BdlGame>("/nba/v1/games", { "dates[]": [today] });
  console.log(`${games.length} games on ${today}`);
  if (games.length === 0) return;
  const odds = await client.getAllPages<BdlBettingOdd>("/nba/v2/odds", { "dates[]": [today] });
  console.log(`\n== GAME ODDS: ${odds.length} rows. Fields: ${Object.keys(odds[0] ?? {}).join(", ")}`);
  for (const vendor of [...new Set(odds.map((odd) => odd.vendor))]) {
    const sample = odds.find((odd) => odd.vendor === vendor)!;
    console.log(`- ${vendor}: ${describeLinks(sample as unknown as Record<string, unknown>)}`);
  }
  const game = games.find((candidate) => candidate.status_state === "in_progress") ?? games[0];
  const propsResponse = await client.get<BdlListResponse<BdlPlayerProp>>("/nba/v2/odds/player_props", { game_id: game.id });
  const props = propsResponse.data ?? [];
  console.log(`\n== PLAYER PROPS for game ${game.id} (${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}): ${props.length} rows. Fields: ${Object.keys(props[0] ?? {}).join(", ")}`);
  for (const vendor of [...new Set(props.map((prop) => prop.vendor))]) {
    const vendorProps = props.filter((prop) => prop.vendor === vendor);
    const withLinks = vendorProps.filter((prop) => /link|url|deep/i.test(JSON.stringify(Object.keys(prop))) && JSON.stringify(prop).match(/https?:|url_template/));
    const sample = withLinks[0] ?? vendorProps[0];
    console.log(`- ${vendor}: ${withLinks.length}/${vendorProps.length} props carry links. Sample (${sample.prop_type} ${sample.market.type}): ${describeLinks(sample as unknown as Record<string, unknown>)}`);
  }
  console.log(`\n${client.callCount} BDL calls`);
}

main().catch((caughtError) => {
  console.error(caughtError instanceof Error ? caughtError.message : caughtError);
  process.exit(1);
});
