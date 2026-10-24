import { cachePolicies } from "@/config/cacheTtls";
import { vercelHobbyLimits } from "@/config/vercelLimits";
import { goatMonthlyPriceUsd } from "@/config/tiers";

export interface WhatIfInputs {
  viewers: number;
  hoursPerDay: number; // visible hours per viewer per day
  livePollSeconds: number;
  slatePollMinutes: number;
  liveShare: number; // share of visible time with a game in progress, 0-1
  propGamesWatched: number; // games whose props are open at once
  daysPerMonth: number;
  averageResponseKb: number;
  averageFunctionMs: number;
  overlapping: boolean; // viewers watch at the same time, so they share CDN fills
}

export interface UsageProjection {
  edgeRequests: number;
  functionInvocations: number;
  bdlCalls: number;
  peakBdlPerMinute: number;
  activeCpuHours: number;
  dataTransferGb: number;
  limitShares: Record<"edgeRequests" | "functionInvocations" | "activeCpuHours" | "dataTransferGb", number>;
  withinHobby: boolean;
  extraInfraCostUsd: number;
  bdlCostPerDayUsd: number;
}

const bdlCallsPerFill = { live: 1, liveOdds: 1, props: 1, schedule: 1, injuries: 2, openingOdds: 1, finals: 40 }; // finals: games, 5 stat periods, 5 advanced periods, lineups, plays

export function projectUsage(inputs: WhatIfInputs): UsageProjection {
  const viewers = Math.max(0, inputs.viewers);
  const visibleHoursMonth = viewers * inputs.hoursPerDay * inputs.daysPerMonth;
  const liveHoursMonth = visibleHoursMonth * inputs.liveShare;
  const slateRequestsPerPoll = 4; // schedule, live odds, opening odds, injuries
  const edgeRequests =
    (liveHoursMonth * 3600) / Math.max(5, inputs.livePollSeconds) +
    (liveHoursMonth * 3600 * inputs.propGamesWatched) / 60 +
    ((visibleHoursMonth * 60) / Math.max(1, inputs.slatePollMinutes)) * slateRequestsPerPoll +
    visibleHoursMonth * 2; // page loads, config and the manifest
  const coveredHoursPerDay = inputs.overlapping ? Math.min(24, inputs.hoursPerDay) : Math.min(24, inputs.hoursPerDay * Math.max(1, viewers)); // the CDN copy is shared, so fills follow the hours someone is watching
  const coveredHoursMonth = viewers === 0 ? 0 : coveredHoursPerDay * inputs.daysPerMonth;
  const coveredLiveHours = coveredHoursMonth * inputs.liveShare;
  const fillsPerHour = (ttlSeconds: number, pollSeconds: number) => 3600 / Math.max(ttlSeconds, pollSeconds); // a fill happens at most once per TTL and only if someone asks
  const slatePollSeconds = inputs.slatePollMinutes * 60;
  const fills = {
    live: coveredLiveHours * fillsPerHour(cachePolicies.liveBoxScores.sMaxAgeSeconds, inputs.livePollSeconds),
    liveOdds: coveredHoursMonth * fillsPerHour(cachePolicies.liveOdds.sMaxAgeSeconds, slatePollSeconds),
    props: coveredLiveHours * inputs.propGamesWatched * fillsPerHour(cachePolicies.liveProps.sMaxAgeSeconds, 60),
    schedule: coveredHoursMonth * fillsPerHour(cachePolicies.schedule.sMaxAgeSeconds, slatePollSeconds),
    injuries: coveredHoursMonth * fillsPerHour(cachePolicies.injuries.sMaxAgeSeconds, slatePollSeconds),
    openingOdds: coveredHoursMonth * fillsPerHour(cachePolicies.openingOdds.sMaxAgeSeconds, slatePollSeconds),
    finals: viewers === 0 ? 0 : inputs.daysPerMonth, // one new finished date per day, cached 30 days
  };
  const functionInvocations = Object.values(fills).reduce((runningTotal, fillCount) => runningTotal + fillCount, 0) + (viewers === 0 ? 0 : inputs.daysPerMonth * 4); // plus config and season-dates refreshes
  const bdlCalls = (Object.keys(fills) as Array<keyof typeof fills>).reduce((runningTotal, fillName) => runningTotal + fills[fillName] * bdlCallsPerFill[fillName], 0);
  const peakBdlPerMinute = Math.max(bdlCallsPerFill.finals, 60 / cachePolicies.liveBoxScores.sMaxAgeSeconds + 1 + inputs.propGamesWatched + 1); // a finals fill bursts ~40 calls once a day
  const activeCpuHours = (functionInvocations * inputs.averageFunctionMs * 0.2) / 3_600_000; // CPU is a fraction of wall time for I/O-bound proxies
  const dataTransferGb = (edgeRequests * inputs.averageResponseKb) / 1_048_576;
  const limitShares = {
    edgeRequests: edgeRequests / vercelHobbyLimits.edgeRequestsPerMonth,
    functionInvocations: functionInvocations / vercelHobbyLimits.functionInvocationsPerMonth,
    activeCpuHours: activeCpuHours / vercelHobbyLimits.activeCpuHoursPerMonth,
    dataTransferGb: dataTransferGb / vercelHobbyLimits.fastDataTransferGbPerMonth,
  };
  return {
    edgeRequests,
    functionInvocations,
    bdlCalls,
    peakBdlPerMinute,
    activeCpuHours,
    dataTransferGb,
    limitShares,
    withinHobby: Object.values(limitShares).every((share) => share <= 1),
    extraInfraCostUsd: 0, // Hobby never bills: going over pauses the project instead
    bdlCostPerDayUsd: goatMonthlyPriceUsd / 30.44,
  };
}

export const defaultWhatIf: WhatIfInputs = {
  viewers: 1,
  hoursPerDay: 3,
  livePollSeconds: 30,
  slatePollMinutes: 10,
  liveShare: 0.6,
  propGamesWatched: 1,
  daysPerMonth: 30,
  averageResponseKb: 25,
  averageFunctionMs: 400,
  overlapping: true,
};
