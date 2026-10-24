import { beforeEach, describe, expect, it } from "vitest";
import { BdlClient, BdlRequestError, buildQueryString } from "@/lib/bdl/bdlClient";
import { RateBudget } from "@/lib/bdl/rateBudget";
import { resetUsageCounters, usageSnapshot } from "@/lib/server/usageCounters";

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("query strings", () => {
  it("explodes arrays and keeps literal brackets", () => {
    expect(buildQueryString({ "dates[]": ["2026-10-22", "2026-10-23"], period: 2, cursor: undefined })).toBe("?dates[]=2026-10-22&dates[]=2026-10-23&period=2");
    expect(buildQueryString({ game_ids: [1, 2] })).toBe("?game_ids=1&game_ids=2");
    expect(buildQueryString({})).toBe("");
  });
});

describe("rate budget", () => {
  it("never grants more than the limit inside a window", async () => {
    let clockMs = 0;
    const sleeps: number[] = [];
    const budget = new RateBudget({ requestsPerMinute: 3, now: () => clockMs, sleep: async (delayMs) => { sleeps.push(delayMs); clockMs += delayMs; } });
    for (let callIndex = 0; callIndex < 7; callIndex++) await budget.acquire();
    expect(budget.peakObservedPerMinute()).toBe(3);
    expect(sleeps.length).toBe(2); // calls 4 and 7 had to wait for the window to roll
    expect(clockMs).toBeGreaterThanOrEqual(120_000);
  });

  it("serializes concurrent callers", async () => {
    let clockMs = 0;
    const budget = new RateBudget({ requestsPerMinute: 2, now: () => clockMs, sleep: async (delayMs) => { clockMs += delayMs; } });
    await Promise.all([budget.acquire(), budget.acquire(), budget.acquire()]);
    expect(budget.peakObservedPerMinute()).toBe(2);
  });
});

describe("BDL client", () => {
  beforeEach(() => resetUsageCounters());

  it("requires a key outside mock mode", () => {
    expect(() => new BdlClient({ tier: "goat" })).toThrow(/BDL_API_KEY/);
  });

  it("sends the key only in the Authorization header and retries 429 with backoff", async () => {
    const seenRequests: Array<{ requestUrl: string; authorization: string | null }> = [];
    const responses = [fakeResponse(429, {}, { "retry-after": "1" }), fakeResponse(503, {}), fakeResponse(200, { data: [{ id: 7 }] })];
    const sleeps: number[] = [];
    const client = new BdlClient({
      tier: "goat",
      apiKey: "secret-key",
      sleep: async (delayMs) => { sleeps.push(delayMs); },
      fetchImplementation: async (input, init) => {
        seenRequests.push({ requestUrl: String(input), authorization: new Headers(init?.headers).get("Authorization") });
        return responses.shift()!;
      },
    });
    const result = await client.get<{ data: Array<{ id: number }> }>("/nba/v1/teams", {});
    expect(result.data[0].id).toBe(7);
    expect(seenRequests).toHaveLength(3);
    expect(seenRequests.every((seen) => seen.authorization === "secret-key" && !seen.requestUrl.includes("secret-key"))).toBe(true);
    expect(sleeps[0]).toBe(1000); // honored Retry-After
    expect(client.callCount).toBe(3);
    const snapshot = usageSnapshot();
    expect(snapshot.bdlCallsByEndpoint["/nba/v1/teams"].retries).toBe(2);
    expect(snapshot.bdlCallsByEndpoint["/nba/v1/teams"].rateLimited).toBe(1);
  });

  it("does not retry client errors and never leaks the key in errors", async () => {
    const client = new BdlClient({ tier: "goat", apiKey: "secret-key", sleep: async () => undefined, fetchImplementation: async () => fakeResponse(401, {}) });
    const failure = await client.get("/nba/v2/odds", {}).catch((caughtError) => caughtError);
    expect(failure).toBeInstanceOf(BdlRequestError);
    expect((failure as BdlRequestError).status).toBe(401);
    expect(String((failure as Error).message)).not.toContain("secret-key");
    expect(client.callCount).toBe(1);
  });

  it("follows cursors across pages", async () => {
    const pages = [fakeResponse(200, { data: [1, 2], meta: { next_cursor: 5, per_page: 100 } }), fakeResponse(200, { data: [3], meta: { next_cursor: null, per_page: 100 } })];
    const seenUrls: string[] = [];
    const client = new BdlClient({ tier: "goat", apiKey: "secret-key", fetchImplementation: async (input) => { seenUrls.push(String(input)); return pages.shift()!; } });
    expect(await client.getAllPages<number>("/nba/v1/games", { "dates[]": ["2026-10-22"] })).toEqual([1, 2, 3]);
    expect(seenUrls[1]).toContain("cursor=5");
    expect(seenUrls[0]).toContain("per_page=100");
  });
});
