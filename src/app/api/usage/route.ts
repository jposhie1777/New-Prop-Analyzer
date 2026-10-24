import { noStoreJson } from "@/lib/server/routeHelpers";
import { usageSnapshot } from "@/lib/server/usageCounters";
import { serverTier } from "@/lib/bdl/bdlClient";
import { tierRequestsPerMinute } from "@/config/tiers";

export const dynamic = "force-dynamic";

export async function GET() {
  const tier = serverTier();
  return noStoreJson({ tier, tierLimitPerMinute: tierRequestsPerMinute[tier], ...usageSnapshot() }); // never cached, read only by /costs
}
