import { BdlClient } from "@/lib/bdl/bdlClient";
import { ncaabTier } from "./ncaabTier";

const globalHolder = globalThis as unknown as { pulseNcaabClient?: BdlClient };

export function getServerNcaabClient(): BdlClient {
  globalHolder.pulseNcaabClient ??= new BdlClient({ tier: ncaabTier(), apiKey: process.env.BDL_API_KEY }); // college has its own 60-a-minute budget
  return globalHolder.pulseNcaabClient;
}
