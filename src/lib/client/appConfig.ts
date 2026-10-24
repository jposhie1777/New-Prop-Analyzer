import { fetchApi } from "./apiClient";

export interface AppConfig {
  tier: string;
  mockMode: boolean;
  requestsPerMinute: number;
  goatEndpoints: boolean;
  keyConfigured: boolean;
  baselinePath: string;
  defaults: { state: string; evThresholdPercent: number };
  currentSeason: number;
  lastSeason: number;
}

let configPromise: Promise<AppConfig> | null = null;

export function loadAppConfig(): Promise<AppConfig> {
  configPromise ??= fetchApi<AppConfig>("/api/config").catch((caughtError) => {
    configPromise = null; // allow a retry on the next call
    throw caughtError;
  });
  return configPromise;
}
