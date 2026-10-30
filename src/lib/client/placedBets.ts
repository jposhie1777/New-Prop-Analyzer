"use client";

import { readLocalJson, writeLocalJson } from "./safeStorage";
import { selectedOffer, type SlipPick } from "./betSlip";
import { parlayAmericanOdds } from "@/lib/math/odds";

export interface PlacedLeg {
  pickId: string;
  kind: SlipPick["kind"];
  gameId: number;
  gameDate: string;
  market: SlipPick["market"];
  selectionKey: string;
  label: string;
  detail: string;
  propType: string | null;
  playerId: number | null;
  lineValue: number | null;
  americanOdds: number | null;
  vendor: string | null;
  sport?: "nba" | "ncaab";
}

export interface PlacedBet {
  betId: string;
  placedAt: string;
  type: "single" | "parlay";
  legs: PlacedLeg[];
  americanOdds: number | null;
  vendor: string | null;
  via: string; // how it left the slip: copy, book, gambly
}

const placedStorageKey = "pulse-nba-placed-bets";
const placedListeners = new Set<(bets: PlacedBet[]) => void>();
const keepDays = 30; // older bets drop off the list

export function readPlacedBets(): PlacedBet[] {
  const stored = readLocalJson<PlacedBet[]>(placedStorageKey, []);
  return Array.isArray(stored) ? stored.filter((bet) => bet && typeof bet.betId === "string" && Array.isArray(bet.legs)) : [];
}

function writePlacedBets(bets: PlacedBet[]): void {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  const kept = bets.filter((bet) => bet.placedAt >= cutoff);
  writeLocalJson(placedStorageKey, kept);
  for (const listener of placedListeners) listener(kept);
}

export function replacePlacedBets(bets: PlacedBet[]): void {
  writePlacedBets(bets.filter((bet) => bet && typeof bet.betId === "string" && Array.isArray(bet.legs))); // bets saved on another device
}

export function subscribePlacedBets(listener: (bets: PlacedBet[]) => void): () => void {
  placedListeners.add(listener);
  const onStorage = (storageEvent: StorageEvent) => {
    if (storageEvent.key === placedStorageKey) listener(readPlacedBets()); // keep tabs in sync
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    placedListeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

function legFrom(pick: SlipPick, defaultBook: string, vendor: string | null): PlacedLeg {
  const offer = (vendor ? pick.offers.find((candidate) => candidate.vendor === vendor) : null) ?? selectedOffer(pick, defaultBook);
  return { pickId: pick.pickId, kind: pick.kind, gameId: pick.gameId, gameDate: pick.gameDate, market: pick.market, selectionKey: pick.selectionKey, label: pick.label, detail: pick.detail, propType: pick.propType, playerId: pick.playerId, lineValue: offer?.lineValue ?? null, americanOdds: offer?.americanOdds ?? null, vendor: offer?.vendor ?? null, sport: pick.sport };
}

export function placeBets(picks: SlipPick[], type: PlacedBet["type"], via: string, defaultBook: string, parlayVendor: string | null = null): number {
  if (picks.length === 0) return 0;
  const existing = readPlacedBets();
  const signatures = new Set(existing.map((bet) => `${bet.type}|${bet.legs.map((leg) => leg.pickId).sort().join(",")}`));
  const placedAt = new Date().toISOString();
  const groups = type === "parlay" && picks.length > 1 ? [picks] : picks.map((pick) => [pick]);
  const additions: PlacedBet[] = [];
  for (const group of groups) {
    const betType: PlacedBet["type"] = group.length > 1 ? "parlay" : "single";
    const signature = `${betType}|${group.map((pick) => pick.pickId).sort().join(",")}`;
    if (signatures.has(signature)) continue; // copying the same bet twice tracks it once
    const legs = group.map((pick) => legFrom(pick, defaultBook, betType === "parlay" ? parlayVendor : null));
    const allPriced = legs.every((leg) => leg.americanOdds !== null);
    additions.push({ betId: `${placedAt}-${signature}`, placedAt, type: betType, legs, americanOdds: allPriced ? (legs.length > 1 ? parlayAmericanOdds(legs.map((leg) => leg.americanOdds!)) : legs[0].americanOdds) : null, vendor: betType === "parlay" ? parlayVendor : legs[0].vendor, via });
    signatures.add(signature);
  }
  if (additions.length > 0) writePlacedBets([...additions, ...existing]);
  return additions.length;
}

export function removePlacedBet(betId: string): void {
  writePlacedBets(readPlacedBets().filter((bet) => bet.betId !== betId));
}
