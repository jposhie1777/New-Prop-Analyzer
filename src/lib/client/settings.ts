import { appSettings } from "@/config/appSettings";
import { readLocalJson, writeLocalJson } from "./safeStorage";

export interface UserSettings {
  sportsbookState: string;
  evThresholdPercent: number;
  wagerAmount: number;
  pickType: string;
  enabledBooks: string[]; // empty = every book
  defaultBook: string; // "" = best price
  liveLayout: "grid" | "rows"; // how All player props is drawn on the Live tab
  threeQuarterMinimumPercent: number; // rating needed for a 100-in-3 recommendation
  threeQuarterMaxPicks: number;
  appearance: Appearance;
}

export type Appearance = "light" | "dark" | "system";

export const settingsStorageKey = "pulse-nba-settings"; // also read by the theme script in the layout, before React loads
const settingsListeners = new Set<(settings: UserSettings) => void>();

export function defaultSettings(): UserSettings {
  return {
    sportsbookState: appSettings.defaultSportsbookState,
    evThresholdPercent: appSettings.defaultEvThresholdPercent,
    wagerAmount: appSettings.defaultWagerAmount,
    pickType: appSettings.defaultPickType,
    enabledBooks: [],
    defaultBook: "",
    liveLayout: "grid",
    threeQuarterMinimumPercent: appSettings.defaultThreeQuarterMinimumPercent,
    threeQuarterMaxPicks: appSettings.defaultThreeQuarterMaxPicks,
    appearance: "light",
  };
}

export function readSettings(): UserSettings {
  return { ...defaultSettings(), ...readLocalJson<Partial<UserSettings>>(settingsStorageKey, {}) };
}

export function saveSettings(update: Partial<UserSettings>): UserSettings {
  const nextSettings = { ...readSettings(), ...update };
  nextSettings.sportsbookState = nextSettings.sportsbookState.trim().toLowerCase().slice(0, 2) || appSettings.defaultSportsbookState;
  nextSettings.liveLayout = nextSettings.liveLayout === "rows" ? "rows" : "grid";
  nextSettings.appearance = nextSettings.appearance === "dark" || nextSettings.appearance === "system" ? nextSettings.appearance : "light";
  nextSettings.enabledBooks = Array.isArray(nextSettings.enabledBooks) ? nextSettings.enabledBooks.filter((vendor) => typeof vendor === "string") : [];
  writeLocalJson(settingsStorageKey, nextSettings);
  for (const listener of settingsListeners) listener(nextSettings);
  return nextSettings;
}

export function subscribeSettings(listener: (settings: UserSettings) => void): () => void {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}
