import { runCachedRoute } from "@/lib/server/routeHelpers";
import { serverTier } from "@/lib/bdl/bdlClient";
import { tierHasGoatEndpoints, tierRequestsPerMinute } from "@/config/tiers";
import { appSettings } from "@/config/appSettings";

export const dynamic = "force-dynamic";

const rawBase = "https://raw.githubusercontent.com/jposhie1777/New-Prop-Analyzer";
const defaultSiteDataBase = `${rawBase}/site-data`; // rebuilt every morning by .github/workflows/site-data.yml

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
        siteDataBase: process.env.SITE_DATA_BASE ?? (tier === "mock" ? null : defaultSiteDataBase),
        ncaabDataBase: process.env.NCAAB_DATA_BASE ?? (tier === "mock" ? "/api/ncaab/files/data" : `${rawBase}/ncaab-data`), // ratings, box scores and the record, rebuilt every morning
        ncaabOddsBase: process.env.NCAAB_ODDS_BASE ?? (tier === "mock" ? "/api/ncaab/files/odds" : `${rawBase}/ncaab-odds`), // The Odds API pulls, three a day
        defaults: { state: appSettings.defaultSportsbookState, evThresholdPercent: appSettings.defaultEvThresholdPercent },
        currentSeason: appSettings.currentSeason,
        lastSeason: appSettings.lastSeason,
      },
    };
  });
}
