import { RateBudget } from "./rateBudget";
import type { BdlListResponse } from "./types";
import { resolveTier, tierRequestsPerMinute, type BdlTier } from "@/config/tiers";
import { recordBdlCall, recordBdlFailure, recordBdlRetry } from "@/lib/server/usageCounters";
import { handleMockRequest } from "./mock/mockApi";

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type QueryParams = Record<string, QueryValue>;

export const bdlBaseUrl = "https://api.balldontlie.io";

export class BdlRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "BdlRequestError";
  }
}

export interface BdlClientOptions {
  tier: BdlTier;
  apiKey?: string;
  fetchImplementation?: typeof fetch;
  rateBudget?: RateBudget;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onCall?: (path: string) => void;
}

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export function buildQueryString(params: QueryParams): string {
  const searchParams = new URLSearchParams();
  for (const [paramName, paramValue] of Object.entries(params)) {
    if (paramValue === undefined || paramValue === null || paramValue === "") continue;
    if (Array.isArray(paramValue)) for (const arrayItem of paramValue) searchParams.append(paramName, String(arrayItem)); // spec uses form/explode arrays
    else searchParams.append(paramName, String(paramValue));
  }
  const encoded = searchParams.toString().replace(/%5B%5D=/g, "[]="); // keep the literal [] suffix the spec documents
  return encoded ? `?${encoded}` : "";
}

export class BdlClient {
  readonly tier: BdlTier;
  readonly rateBudget: RateBudget;
  private readonly apiKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleepFor: (delayMs: number) => Promise<void>;
  private readonly onCall?: (path: string) => void;
  callCount = 0;

  constructor(options: BdlClientOptions) {
    this.tier = options.tier;
    this.apiKey = options.apiKey ?? "";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.rateBudget = options.rateBudget ?? new RateBudget({ requestsPerMinute: tierRequestsPerMinute[options.tier] });
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.sleepFor = options.sleep ?? defaultSleep;
    this.onCall = options.onCall;
    if (this.tier !== "mock" && !this.apiKey) throw new Error("BDL_API_KEY is not set. Add it as a secret or use BDL_TIER=mock.");
  }

  async get<ResponseType>(path: string, params: QueryParams = {}): Promise<ResponseType> {
    if (this.tier === "mock") {
      this.countCall(path);
      return handleMockRequest(path, params) as ResponseType;
    }
    const requestUrl = `${bdlBaseUrl}${path}${buildQueryString(params)}`;
    let lastError: unknown;
    for (let attemptNumber = 1; attemptNumber <= this.maxAttempts; attemptNumber++) {
      await this.rateBudget.acquire(); // every attempt, including retries, spends budget
      this.countCall(path);
      try {
        const response = await this.fetchImplementation(requestUrl, { headers: { Authorization: this.apiKey, Accept: "application/json" }, cache: "no-store" });
        if (response.ok) return (await response.json()) as ResponseType;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attemptNumber === this.maxAttempts) {
          recordBdlFailure(path);
          throw new BdlRequestError(`BDL ${response.status} for ${path}`, response.status, path); // message never includes the key
        }
        recordBdlRetry(path, response.status === 429);
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : this.backoffDelay(attemptNumber);
        await this.sleepFor(backoffMs);
      } catch (caughtError) {
        if (caughtError instanceof BdlRequestError) throw caughtError;
        lastError = caughtError;
        if (attemptNumber === this.maxAttempts) break;
        recordBdlRetry(path, false);
        await this.sleepFor(this.backoffDelay(attemptNumber)); // network error, back off and retry
      }
    }
    recordBdlFailure(path);
    throw new BdlRequestError(`BDL request failed for ${path}: ${lastError instanceof Error ? lastError.message : "network error"}`, 0, path);
  }

  async getAllPages<ItemType>(path: string, params: QueryParams = {}, maxPages = 500): Promise<ItemType[]> {
    const collected: ItemType[] = [];
    let cursor: number | null | undefined;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      const page = await this.get<BdlListResponse<ItemType>>(path, { ...params, per_page: 100, cursor: cursor ?? undefined });
      collected.push(...(page.data ?? []));
      cursor = page.meta?.next_cursor;
      if (!cursor) break;
    }
    return collected;
  }

  private backoffDelay(attemptNumber: number): number {
    return this.baseDelayMs * 2 ** (attemptNumber - 1) + Math.floor(Math.random() * 250); // exponential backoff with jitter
  }

  private countCall(path: string): void {
    this.callCount += 1;
    recordBdlCall(path);
    this.onCall?.(path);
  }
}

const globalHolder = globalThis as unknown as { pulseBdlClient?: BdlClient };

export function serverTier(): BdlTier {
  return resolveTier(process.env.BDL_TIER);
}

export function getServerBdlClient(): BdlClient {
  if (!globalHolder.pulseBdlClient) {
    globalHolder.pulseBdlClient = new BdlClient({ tier: serverTier(), apiKey: process.env.BDL_API_KEY }); // one client and budget per server instance
  }
  return globalHolder.pulseBdlClient;
}
