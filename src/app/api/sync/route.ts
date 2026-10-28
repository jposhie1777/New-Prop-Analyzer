import { noStoreJson, badRequest } from "@/lib/server/routeHelpers";
import { readFile, writeFile } from "node:fs/promises";
import { readSyncState, syncToken, writeSyncState } from "@/lib/server/syncGist";
import { emptySyncState, mergeSyncState, type SyncState } from "@/lib/sync/syncState";

export const dynamic = "force-dynamic";

const maximumBodyBytes = 200_000;

interface SyncBackend {
  read: () => Promise<SyncState>;
  write: (state: SyncState) => Promise<void>;
}

function syncBackend(): SyncBackend | null {
  if (!process.env.SITE_PASSWORD && process.env.NODE_ENV === "production") return null; // never store slips behind an open site
  const localFile = process.env.NODE_ENV !== "production" ? process.env.SYNC_LOCAL_FILE : undefined; // development only: a JSON file instead of GitHub
  if (localFile) {
    return {
      read: async () => {
        try {
          return { ...emptySyncState(), ...(JSON.parse(await readFile(localFile, "utf8")) as Partial<SyncState>) };
        } catch {
          return emptySyncState();
        }
      },
      write: (state) => writeFile(localFile, JSON.stringify(state)),
    };
  }
  const token = syncToken();
  return token ? { read: () => readSyncState(token), write: (state) => writeSyncState(token, state) } : null;
}

export async function GET() {
  const backend = syncBackend();
  if (!backend) return noStoreJson({ enabled: false });
  try {
    return noStoreJson({ enabled: true, state: await backend.read() });
  } catch (caughtError) {
    return noStoreJson({ enabled: true, error: caughtError instanceof Error ? caughtError.message : "sync failed" }, 502); // the token never appears in these messages
  }
}

export async function PUT(request: Request) {
  const backend = syncBackend();
  if (!backend) return noStoreJson({ enabled: false });
  const bodyText = await request.text();
  if (bodyText.length > maximumBodyBytes) return badRequest("Too much to sync");
  let incoming: Partial<SyncState>;
  try {
    incoming = JSON.parse(bodyText) as Partial<SyncState>;
  } catch {
    return badRequest("Body must be JSON");
  }
  try {
    const merged = mergeSyncState(await backend.read(), incoming);
    await backend.write(merged);
    return noStoreJson({ enabled: true, state: merged });
  } catch (caughtError) {
    return noStoreJson({ enabled: true, error: caughtError instanceof Error ? caughtError.message : "sync failed" }, 502);
  }
}
