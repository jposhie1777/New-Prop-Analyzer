"use client";

import { PriceButton } from "@/components/PriceButton";
import type { HitRateResult } from "@/lib/analytics/aggregates/playerAggregates";
import type { PropMarketSummary } from "@/lib/client/pickBuilders";
import { buildMilestonePick, buildPropPick } from "@/lib/client/pickBuilders";
import { formatPercent } from "@/lib/client/format";
import type { BdlBettingOdd, BdlGame, BdlPlayerProp } from "@/lib/bdl/types";
import { propMapping } from "@/lib/analytics/propTypes";

function chipClass(hitRate: number | null): string {
  if (hitRate === null) return "hit-chip";
  if (hitRate >= 0.7) return "hit-chip hot";
  if (hitRate <= 0.3) return "hit-chip cold";
  return "hit-chip";
}

const propOrder = ["points", "rebounds", "assists", "threes", "points_rebounds_assists", "points_rebounds", "points_assists", "rebounds_assists", "steals", "blocks", "points_1q", "rebounds_1q", "assists_1q"];

export function PropHitRates({ game, playerId, playerName, summaries, hitRates, props, gameOdds }: { game: BdlGame; playerId: number; playerName: string; summaries: PropMarketSummary[]; hitRates: HitRateResult[]; props: BdlPlayerProp[]; gameOdds: BdlBettingOdd[] }) {
  if (summaries.length === 0) return <div className="empty-state">No player props posted for this game yet.</div>;
  const ordered = [...summaries].sort((first, second) => propOrder.indexOf(first.propType) - propOrder.indexOf(second.propType));
  const hitsAt = (propType: string, lineValue: number) => hitRates.find((candidate) => candidate.propType === propType && candidate.lineValue === lineValue);
  return (
    <div className="card-grid">
      {ordered.map((summary) => {
        const mainHits = hitsAt(summary.propType, summary.mainLine);
        const extraLines = summary.ladder.filter((rung) => rung.line !== summary.mainLine);
        return (
          <div key={summary.propType} className="player-group">
            <div className="player-group-header">
              <span className="strong">{propMapping(summary.propType)?.label ?? summary.propType}</span>
              <span className="pill accent tabular">{summary.mainLine}</span>
            </div>
            <div className="chip-row" style={{ margin: "6px 0 10px" }}>
              {(["L5", "L10", "L20"] as const).map((windowName) => {
                const windowResult = mainHits?.windows[windowName];
                return (
                  <span key={windowName} className={chipClass(windowResult?.hitRate ?? null)} title={`${windowResult?.hits ?? 0} of ${windowResult?.games ?? 0} games over ${summary.mainLine}`}>
                    <strong>{windowResult?.hitRate === null || windowResult === undefined ? "-" : `${Math.round(windowResult.hitRate * 100)}%`}</strong>
                    {windowName} · {windowResult?.hits ?? 0}/{windowResult?.games ?? 0}
                  </span>
                );
              })}
            </div>
            <div className="price-pair">
              <PriceButton pick={buildPropPick(game, playerId, playerName, summary.propType, "over", props, gameOdds, "player page", null, summary.mainLine)} sideLabel={`O ${summary.mainLine}`} odds={summary.bestOver?.odds ?? null} vendor={summary.bestOver?.vendor ?? null} />
              <PriceButton pick={buildPropPick(game, playerId, playerName, summary.propType, "under", props, gameOdds, "player page", null, summary.mainLine)} sideLabel={`U ${summary.mainLine}`} odds={summary.bestUnder?.odds ?? null} vendor={summary.bestUnder?.vendor ?? null} />
            </div>
            {extraLines.length > 0 || summary.milestones.length > 0 ? (
              <details className="more-lines" style={{ marginTop: 8 }}>
                <summary>More lines ({extraLines.length + summary.milestones.length}) ▾</summary>
                {extraLines.map((rung) => {
                  const rungHits = hitsAt(summary.propType, rung.line);
                  return (
                    <div key={rung.line} className="ladder-row">
                      <span className="tabular strong">{rung.line}</span>
                      <PriceButton pick={buildPropPick(game, playerId, playerName, summary.propType, "over", props, gameOdds, "player page", null, rung.line)} sideLabel={`O ${rung.line}`} odds={rung.bestOver?.odds ?? null} vendor={rung.bestOver?.vendor ?? null} note={rungHits ? `L10 ${formatPercent(rungHits.windows.L10.hitRate, 0)}` : null} />
                      <PriceButton pick={buildPropPick(game, playerId, playerName, summary.propType, "under", props, gameOdds, "player page", null, rung.line)} sideLabel={`U ${rung.line}`} odds={rung.bestUnder?.odds ?? null} vendor={rung.bestUnder?.vendor ?? null} note={rungHits && rungHits.windows.L10.hitRate !== null ? `L10 ${formatPercent(1 - rungHits.windows.L10.hitRate, 0)}` : null} />
                    </div>
                  );
                })}
                {summary.milestones.length > 0 ? (
                  <div className="milestone-grid">
                    {summary.milestones.map((milestone) => {
                      const milestoneHits = hitsAt(summary.propType, milestone.threshold - 0.5);
                      return (
                        <PriceButton
                          key={milestone.threshold}
                          pick={buildMilestonePick(game, playerId, playerName, summary.propType, milestone.threshold, props, gameOdds, "player page")}
                          sideLabel={`${milestone.threshold}+`}
                          odds={milestone.best.odds}
                          vendor={milestone.best.vendor}
                          note={milestoneHits ? `L10 ${formatPercent(milestoneHits.windows.L10.hitRate, 0)}` : null}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
