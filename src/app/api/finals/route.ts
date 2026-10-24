import type { NextRequest } from "next/server";
import { badRequest, runCachedRoute } from "@/lib/server/routeHelpers";
import { getServerBdlClient } from "@/lib/bdl/bdlClient";
import { isIsoDate, todayEastern } from "@/lib/dates";
import { buildFinalsPayload } from "@/lib/server/finalsBuilder";
import { cachePolicies } from "@/config/cacheTtls";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a date needs roughly 20-50 BDL calls

export async function GET(request: NextRequest) {
  const requestedDate = request.nextUrl.searchParams.get("date");
  if (!isIsoDate(requestedDate)) return badRequest("date must be YYYY-MM-DD");
  if (requestedDate >= todayEastern()) return badRequest("only past dates can be final; today is never treated as final");
  return runCachedRoute("finals", "finishedDate", async () => {
    const payload = await buildFinalsPayload(getServerBdlClient(), requestedDate);
    return { body: payload, policy: payload.complete ? cachePolicies.finishedDate : cachePolicies.unfinishedDate }; // only fully final dates are cached as immutable
  });
}
