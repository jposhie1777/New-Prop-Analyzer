import { appSettings } from "@/config/appSettings";
import { readLocalJson, writeLocalJson } from "./safeStorage";

export interface UserSettings {
  sportsbookState: string;
  evThresholdPercent: number;
  wagerAmount: number;
  pickType: string;
  enabledBooks: string[]; // empty = every book
  defaultBook: string; // "" = best price
}

const settingsStorageKey = "pulse-nba-settings";
const settingsListeners = new Set<(settings: UserSettings) => void>();

export function defaultSettings(): UserSettings {
  return {
    sportsbookState: appSettings.defaultSportsbookState,
    evThresholdPercent: appSettings.defaultEvThresholdPercent,
    wagerAmount: appSettings.defaultWagerAmount,
    pickType: appSettings.defaultPickType,
    enabledBooks: [],
    defaultBook: "",
  };
}

export function readSettings(): UserSettings {
  return { ...defaultSettings(), ...readLocalJson<Partial<UserSettings>>(settingsStorageKey, {}) };
}

export function saveSettings(update: Partial<UserSettings>): UserSettings {
  const nextSettings = { ...readSettings(), ...update };
  nextSettings.sportsbookState = nextSettings.sportsbookState.trim().toLowerCase().slice(0, 2) || appSettings.defaultSportsbookState;
  nextSettings.enabledBooks = Array.isArray(nextSettings.enabledBooks) ? nextSettings.enabledBooks.filter((vendor) => typeof vendor === "string") : [];
  writeLocalJson(settingsStorageKey, nextSettings);
  for (const listener of settingsListeners) listener(nextSettings);
  return nextSettings;
}

export function subscribeSettings(listener: (settings: UserSettings) => void): () => void {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}
