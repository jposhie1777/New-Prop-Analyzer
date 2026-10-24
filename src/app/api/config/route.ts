import { runCachedRoute } from "@/lib/server/routeHelpers";
import { serverTier } from "@/lib/bdl/bdlClient";
import { tierHasGoatEndpoints, tierRequestsPerMinute } from "@/config/tiers";
import { appSettings } from "@/config/appSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  return runCachedRoute("config", "appConfig", async () => {
    const tier = serverTier();
    return {
      body: {
        tier,
        mockMode: tier === "mock",
        requestsPerMinute: tierRequestsPerMinute[tier],
        goatEndpoints: tierHasGoatEndpoints(tier),
        keyConfigured: tier === "mock" ? true : Boolean(process.env.BDL_API_KEY), // reports presence only, never the value
        baselinePath: tier === "mock" ? "/data/mock-baseline" : "/data/baseline",
        defaults: { state: appSettings.defaultSportsbookState, evThresholdPercent: appSettings.defaultEvThresholdPercent },
        currentSeason: appSettings.currentSeason,
        lastSeason: appSettings.lastSeason,
      },
    };
  });
}
