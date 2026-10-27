import type { BdlShotChartRow } from "@/lib/bdl/types";
import type { DataRow } from "./rowSchemas";

export const shotZoneKeys = ["rim", "paint", "mid_left", "mid_center", "mid_right", "corner3_left", "corner3_right", "above3_left", "above3_center", "above3_right"] as const;
export type ShotZoneKey = (typeof shotZoneKeys)[number];

export const shotZoneLabels: Record<ShotZoneKey, string> = {
  rim: "Restricted area",
  paint: "Paint (non-RA)",
  mid_left: "Left mid-range",
  mid_center: "Center mid-range",
  mid_right: "Right mid-range",
  corner3_left: "Left corner 3",
  corner3_right: "Right corner 3",
  above3_left: "Left wing 3",
  above3_center: "Top of the key 3",
  above3_right: "Right wing 3",
};

export const threePointZones = new Set<ShotZoneKey>(["corner3_left", "corner3_right", "above3_left", "above3_center", "above3_right"]);

function sideFromArea(zoneArea: string): "left" | "center" | "right" | null {
  if (/left/i.test(zoneArea)) return "left"; // "Left Side(L)" and "Left Side Center(LC)"
  if (/right/i.test(zoneArea)) return "right";
  if (/center/i.test(zoneArea)) return "center";
  return null;
}

function sideFromCoordinate(coordinateX: number | null | undefined, centerWidth: number): "left" | "center" | "right" | null {
  if (coordinateX === null || coordinateX === undefined || !Number.isFinite(coordinateX)) return null;
  const offset = coordinateX - 25; // BDL's x runs 0-50 feet across the court with the basket at 25
  if (offset <= -centerWidth) return "left";
  if (offset >= centerWidth) return "right";
  return "center";
}

export function classifyShotZone(shot: Pick<BdlShotChartRow, "shot_value" | "shot_distance" | "shot_zone_basic"> & { shot_zone_area?: string | null; coordinate_x?: number | null }): ShotZoneKey | null {
  const zoneBasic = shot.shot_zone_basic ?? "";
  const zoneArea = shot.shot_zone_area ?? "";
  const distanceFeet = shot.shot_distance ?? null;
  if (/backcourt/i.test(zoneBasic) || (distanceFeet !== null && distanceFeet > 40)) return null; // heaves tell us nothing
  const isThree = shot.shot_value === 3 || /3/.test(zoneBasic);
  if (isThree) {
    if (/left corner/i.test(zoneBasic)) return "corner3_left";
    if (/right corner/i.test(zoneBasic)) return "corner3_right";
    const side = sideFromArea(zoneArea) ?? sideFromCoordinate(shot.coordinate_x, 8);
    if (/corner/i.test(zoneBasic)) return side === "right" ? "corner3_right" : "corner3_left";
    return side === "left" ? "above3_left" : side === "right" ? "above3_right" : "above3_center";
  }
  if (/restricted/i.test(zoneBasic) || (!zoneBasic && distanceFeet !== null && distanceFeet <= 4)) return "rim";
  if (/paint/i.test(zoneBasic) || (!zoneBasic && distanceFeet !== null && distanceFeet <= 9)) return "paint";
  const side = sideFromArea(zoneArea) ?? sideFromCoordinate(shot.coordinate_x, 6);
  return side === "left" ? "mid_left" : side === "right" ? "mid_right" : "mid_center";
}

export interface ShotGameContext {
  season: number;
  gameDate: string;
  homeTeamId: number;
  visitorTeamId: number;
}

export function aggregateShotZones(shots: BdlShotChartRow[], gameContexts: Map<number, ShotGameContext>): DataRow[] {
  const tallies = new Map<string, DataRow & { attempts: number; makes: number }>();
  for (const shot of shots) {
    const gameContext = gameContexts.get(shot.game_id);
    const zone = classifyShotZone(shot);
    if (!gameContext || !zone) continue;
    const tallyKey = `${shot.game_id}|${shot.player_id}|${zone}`;
    const tally = tallies.get(tallyKey) ?? {
      season: gameContext.season,
      game_date: gameContext.gameDate,
      game_id: shot.game_id,
      player_id: shot.player_id,
      team_id: shot.team_id,
      opponent_team_id: shot.team_id === gameContext.homeTeamId ? gameContext.visitorTeamId : gameContext.homeTeamId,
      zone,
      attempts: 0,
      makes: 0,
    };
    tally.attempts += 1;
    if (shot.made) tally.makes += 1;
    tallies.set(tallyKey, tally);
  }
  return [...tallies.values()]; // one row per player, game and zone keeps a season to ~150k small rows
}
