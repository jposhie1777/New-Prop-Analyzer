import { emptySyncState, type SyncState } from "@/lib/sync/syncState";

const gistDescription = "pulse-nba-sync"; // found by this description when SYNC_GIST_ID is not set
const gistFileName = "pulse-nba-sync.json";
let cachedGistId: string | null = null;

function githubHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pulse-nba" };
}

export function syncToken(): string | null {
  return process.env.SYNC_GITHUB_TOKEN || null;
}

async function findOrCreateGist(token: string): Promise<string> {
  if (process.env.SYNC_GIST_ID) return process.env.SYNC_GIST_ID;
  if (cachedGistId) return cachedGistId;
  for (let pageNumber = 1; pageNumber <= 5; pageNumber++) {
    const listResponse = await fetch(`https://api.github.com/gists?per_page=100&page=${pageNumber}`, { headers: githubHeaders(token), cache: "no-store" });
    if (!listResponse.ok) throw new Error(`GitHub gists ${listResponse.status}`);
    const gists = (await listResponse.json()) as Array<{ id: string; description: string | null }>;
    const found = gists.find((gist) => gist.description === gistDescription);
    if (found) return (cachedGistId = found.id);
    if (gists.length < 100) break;
  }
  const createResponse = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ description: gistDescription, public: false, files: { [gistFileName]: { content: JSON.stringify(emptySyncState()) } } }), // secret gist: not listed or searchable
  });
  if (!createResponse.ok) throw new Error(`GitHub create gist ${createResponse.status}`);
  return (cachedGistId = ((await createResponse.json()) as { id: string }).id);
}

export async function readSyncState(token: string): Promise<SyncState> {
  const gistId = await findOrCreateGist(token);
  const response = await fetch(`https://api.github.com/gists/${gistId}`, { headers: githubHeaders(token), cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub gist ${response.status}`);
  const gist = (await response.json()) as { files: Record<string, { content?: string; truncated?: boolean; raw_url?: string }> };
  const file = gist.files[gistFileName];
  if (!file) return emptySyncState();
  const content = file.truncated && file.raw_url ? await (await fetch(file.raw_url, { headers: githubHeaders(token), cache: "no-store" })).text() : (file.content ?? "");
  try {
    return { ...emptySyncState(), ...(JSON.parse(content) as Partial<SyncState>) };
  } catch {
    return emptySyncState();
  }
}

export async function writeSyncState(token: string, state: SyncState): Promise<void> {
  const gistId = await findOrCreateGist(token);
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: githubHeaders(token),
    body: JSON.stringify({ files: { [gistFileName]: { content: JSON.stringify(state) } } }),
  });
  if (!response.ok) throw new Error(`GitHub gist update ${response.status}`);
}
