import type { TableName } from "./rowSchemas";

export interface BaselineTableFile {
  file: string;
  rows: number;
  bytes: number;
}

export interface BaselineSeasonEntry {
  season: number;
  firstDate: string | null;
  lastDate: string | null;
  dateCount: number;
  tables: Partial<Record<TableName, BaselineTableFile>>;
}

export interface BaselineManifest {
  version: 1;
  generatedAt: string;
  tier: string;
  lastDate: string | null; // last finished date covered by the baseline, top-up starts after it
  totalBytes: number;
  seasons: Record<string, BaselineSeasonEntry>;
}

export function isBaselineManifest(candidate: unknown): candidate is BaselineManifest {
  if (!candidate || typeof candidate !== "object") return false;
  const manifestCandidate = candidate as Partial<BaselineManifest>;
  return manifestCandidate.version === 1 && typeof manifestCandidate.seasons === "object" && manifestCandidate.seasons !== null;
}
