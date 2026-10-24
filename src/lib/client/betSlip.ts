import type { BdlDeeplinks } from "@/lib/bdl/types";
import { readLocalJson, writeLocalJson } from "./safeStorage";

export interface SlipOffer {
  vendor: string;
  americanOdds: number;
  lineValue: number | null;
  deeplinks: BdlDeeplinks | null;
  eventDeeplinks: BdlDeeplinks | null; // the game's links from the same book, used for event-page fallbacks
}

export interface SlipPick {
  pickId: string;
  kind: "game" | "prop";
  gameId: number;
  market: "spread" | "total" | "moneyline" | "prop";
  selectionKey: string; // spread_home, total_over, over, under, ...
  label: string;
  detail: string;
  propType: string | null;
  playerId: number | null;
  offers: SlipOffer[];
  modelProbability: number | null;
  source: string;
  addedAt: string;
}

const slipStorageKey = "pulse-nba-bet-slip";
const slipListeners = new Set<(picks: SlipPick[]) => void>();

export function readSlip(): SlipPick[] {
  const stored = readLocalJson<SlipPick[]>(slipStorageKey, []);
  return Array.isArray(stored) ? stored.filter((pick) => pick && typeof pick.pickId === "string" && Array.isArray(pick.offers)) : [];
}

function writeSlip(picks: SlipPick[]): void {
  writeLocalJson(slipStorageKey, picks);
  for (const listener of slipListeners) listener(picks);
}

export function addPick(pick: Omit<SlipPick, "addedAt">): void {
  const others = readSlip().filter((existing) => existing.pickId !== pick.pickId);
  writeSlip([...others, { ...pick, addedAt: new Date().toISOString() }]);
}

export function removePick(pickId: string): void {
  writeSlip(readSlip().filter((existing) => existing.pickId !== pickId));
}

export function clearSlip(): void {
  writeSlip([]);
}

export function subscribeSlip(listener: (picks: SlipPick[]) => void): () => void {
  slipListeners.add(listener);
  const onStorage = (storageEvent: StorageEvent) => {
    if (storageEvent.key === slipStorageKey) listener(readSlip()); // keep tabs in sync
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    slipListeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function bestOffer(pick: SlipPick): SlipOffer | null {
  return [...pick.offers].sort((first, second) => decimalOf(second.americanOdds) - decimalOf(first.americanOdds))[0] ?? null;
}

function decimalOf(americanOdds: number): number {
  return americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / -americanOdds;
}

export function copyTextFor(pick: SlipPick, offer: SlipOffer | null): string {
  const oddsText = offer ? ` ${offer.americanOdds > 0 ? "+" : ""}${offer.americanOdds}` : "";
  return `${pick.label}${pick.detail ? ` (${pick.detail})` : ""}${oddsText}`;
}
