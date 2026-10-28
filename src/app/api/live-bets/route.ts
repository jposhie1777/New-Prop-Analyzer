import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCachedRoute } from "@/lib/server/routeHelpers";
import { combineLivePicks, type LiveBetPick, type LiveNight } from "@/lib/live/liveBets";

export const dynamic = "force-dynamic";

const defaultDataBase = "https://raw.githubusercontent.com/jposhie1777/New-Prop-Analyzer/live-data"; // the branch the GitHub Actions tracker writes

interface TrackerStatus {
  date: string;
  state: LiveNight["state"];
  updatedAt: string;
  picks: number;
  liveGames: number;
  note: string | null;
}

async function readDataFile<ValueType>(relativePath: string): Promise<ValueType | null> {
  const localDirectory = process.env.LIVE_DATA_DIR; // a local tracker folder, for development
  try {
    if (localDirectory) return JSON.parse(await readFile(join(localDirectory, relativePath), "utf8")) as ValueType;
    const response = await fetch(`${process.env.LIVE_DATA_BASE ?? defaultDataBase}/${relativePath}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as ValueType) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  return runCachedRoute("live-bets", "liveBets", async () => {
    const status = await readDataFile<TrackerStatus>("live/status.json");
    if (!status) return { body: { status: null, night: null, picks: [] } };
    const [night, history] = await Promise.all([readDataFile<LiveNight>(`live/${status.date}.json`), readDataFile<LiveBetPick[]>("live/history.json")]);
    return { body: { status, night, picks: combineLivePicks(history ?? [], night?.picks ?? []) } };
  });
}
