"use client";

import { AddToSlipButton } from "@/components/AddToSlipButton";
import type { HitRateResult } from "@/lib/analytics/aggregates/playerAggregates";
import type { PropMarketSummary } from "@/lib/client/pickBuilders";
import { buildPropPick } from "@/lib/client/pickBuilders";
import type { BdlBettingOdd, BdlGame, BdlPlayerProp } from "@/lib/bdl/types";
import { propMapping } from "@/lib/analytics/propTypes";
import { formatAmerican } from "@/lib/math/odds";
import { vendorLabel } from "@/lib/odds/deeplinks";

function chipClass(hitRate: number | null): string {
  if (hitRate === null) return "hit-chip";
  if (hitRate >= 0.7) return "hit-chip hot";
  if (hitRate <= 0.3) return "hit-chip cold";
  return "hit-chip";
}

export function PropHitRates({ game, playerId, playerName, summaries, hitRates, props, gameOdds }: { game: BdlGame; playerId: number; playerName: string; summaries: PropMarketSummary[]; hitRates: HitRateResult[]; props: BdlPlayerProp[]; gameOdds: BdlBettingOdd[] }) {
  if (summaries.length === 0) return <div className="empty-state">No player props posted for this game yet.</div>;
  const ordered = [...summaries].sort((first, second) => Object.keys(propOrder).indexOf(first.propType) - Object.keys(propOrder).indexOf(second.propType));
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
      {ordered.map((summary) => {
        const hitResult = hitRates.find((candidate) => candidate.propType === summary.propType && candidate.lineValue === summary.mainLine);
        const mapping = propMapping(summary.propType);
        return (
          <div key={summary.propType} className="prop-card">
            <div className="row-between">
              <span className="strong">{mapping?.label ?? summary.propType}</span>
              <span className="pill accent tabular">{summary.mainLine}</span>
            </div>
            <div className="chip-row">
              {(["L5", "L10", "L20"] as const).map((windowName) => {
                const windowResult = hitResult?.windows[windowName];
                return (
                  <span key={windowName} className={chipClass(windowResult?.hitRate ?? null)} title={`${windowResult?.hits ?? 0} of ${windowResult?.games ?? 0} games over ${summary.mainLine}`}>
                    <strong>{windowResult?.hitRate === null || windowResult === undefined ? "-" : `${Math.round(windowResult.hitRate * 100)}%`}</strong>
                    {windowName} · {windowResult?.hits ?? 0}/{windowResult?.games ?? 0}
                  </span>
                );
              })}
            </div>
            <div className="row-between small">
              <span className="muted">
                O {formatAmerican(summary.bestOver?.odds)} <span className="faint">{summary.bestOver ? vendorLabel(summary.bestOver.vendor) : ""}</span>
              </span>
              <span className="muted">
                U {formatAmerican(summary.bestUnder?.odds)} <span className="faint">{summary.bestUnder ? vendorLabel(summary.bestUnder.vendor) : ""}</span>
              </span>
            </div>
            <div className="row">
              <AddToSlipButton pick={buildPropPick(game, playerId, playerName, summary.propType, "over", props, gameOdds, "player page")} label="+ Over" />
              <AddToSlipButton pick={buildPropPick(game, playerId, playerName, summary.propType, "under", props, gameOdds, "player page")} label="+ Under" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const propOrder: Record<string, true> = { points: true, rebounds: true, assists: true, threes: true, points_rebounds_assists: true, points_rebounds: true, points_assists: true, rebounds_assists: true, steals: true, blocks: true, points_1q: true, rebounds_1q: true, assists_1q: true };
