import type { BdlBoxScore, BdlBoxScorePlayer, BdlBoxScoreTeam, BdlTeam } from "./types";
import { parseMinutes } from "@/lib/dates";

type RawBoxSide = Partial<BdlTeam> & { team?: BdlTeam; players?: BdlBoxScorePlayer[] };

export function normalizeBoxSide(rawSide: RawBoxSide | null | undefined): BdlBoxScoreTeam | null {
  if (!rawSide) return null;
  const team: BdlTeam | null = rawSide.team ?? (typeof rawSide.id === "number" ? { id: rawSide.id, conference: rawSide.conference ?? "", division: rawSide.division ?? "", city: rawSide.city ?? "", name: rawSide.name ?? "", full_name: rawSide.full_name ?? "", abbreviation: rawSide.abbreviation ?? "" } : null); // the live API puts team fields next to players, the spec nests them under team
  if (!team) return null;
  const validPlayers = (rawSide.players ?? []).filter((boxPlayer) => boxPlayer && boxPlayer.player && typeof boxPlayer.player.id === "number");
  const byId = new Map<number, BdlBoxScorePlayer>();
  for (const boxPlayer of validPlayers) {
    const existing = byId.get(boxPlayer.player.id);
    if (!existing || parseMinutes(boxPlayer.min) > parseMinutes(existing.min)) byId.set(boxPlayer.player.id, boxPlayer); // the live feed can list a player twice
  }
  const players = [...byId.values()];
  return { team, players };
}

export function normalizeBoxScore(rawBoxScore: unknown): BdlBoxScore | null {
  if (!rawBoxScore || typeof rawBoxScore !== "object") return null;
  const candidate = rawBoxScore as BdlBoxScore & { home_team: RawBoxSide; visitor_team: RawBoxSide };
  const homeSide = normalizeBoxSide(candidate.home_team);
  const visitorSide = normalizeBoxSide(candidate.visitor_team);
  if (!homeSide || !visitorSide) return null;
  return { ...candidate, home_team: homeSide, visitor_team: visitorSide };
}

export function normalizeBoxScores(rawList: unknown): BdlBoxScore[] {
  return Array.isArray(rawList) ? rawList.map(normalizeBoxScore).filter((boxScore): boxScore is BdlBoxScore => boxScore !== null) : [];
}
