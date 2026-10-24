"use client";

import { AddToSlipButton } from "@/components/AddToSlipButton";
import type { HitRateResult } from "@/lib/analytics/aggregates/playerAggregates";
import type { PropMarketSummary } from "@/lib/client/pickBuilders";
import { buildMilestonePick, buildPropPick } from "@/lib/client/pickBuilders";
import { formatPercent } from "@/lib/client/format";
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
    <div className="card-grid">
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
              <AddToSlipButton pick={buildPropPick(game, playerId, playerName, summary.propType, "over", props, gameOdds, "player page", null, summary.mainLine)} label="+ Over" />
              <AddToSlipButton pick={buildPropPick(game, playerId, playerName, summary.propType, "under", props, gameOdds, "player page", null, summary.mainLine)} label="+ Under" />
            </div>
            {summary.ladder.length > 1 || summary.milestones.length > 0 ? (
              <details>
                <summary className="expand-hint">
                  Alt lines ({summary.ladder.length}){summary.milestones.length > 0 ? ` · ${summary.milestones.length} milestones` : ""}
                </summary>
                <div className="table-scroll" style={{ marginTop: 6 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>L10</th>
                        <th>L20</th>
                        <th>Over</th>
                        <th>Under</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.ladder.map((rung) => {
                        const rungHits = hitRates.find((candidate) => candidate.propType === summary.propType && candidate.lineValue === rung.line);
                        return (
                          <tr key={rung.line} style={rung.line === summary.mainLine ? { fontWeight: 700 } : undefined}>
                            <td>{rung.line}</td>
                            <td>{formatPercent(rungHits?.windows.L10.hitRate ?? null, 0)}</td>
                            <td>{formatPercent(rungHits?.windows.L20.hitRate ?? null, 0)}</td>
                            <td>{formatAmerican(rung.bestOver?.odds)}</td>
                            <td>{formatAmerican(rung.bestUnder?.odds)}</td>
                            <td>
                              <span className="row" style={{ gap: 3, justifyContent: "flex-end" }}>
                                <AddToSlipButton pick={buildPropPick(game, playerId, playerName, summary.propType, "over", props, gameOdds, "player page", null, rung.line)} label="O" />
                                <AddToSlipButton pick={buildPropPick(game, playerId, playerName, summary.propType, "under", props, gameOdds, "player page", null, rung.line)} label="U" />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {summary.milestones.map((milestone) => {
                        const milestoneHits = hitRates.find((candidate) => candidate.propType === summary.propType && candidate.lineValue === milestone.threshold - 0.5);
                        return (
                          <tr key={`m${milestone.threshold}`}>
                            <td>{milestone.threshold}+</td>
                            <td>{formatPercent(milestoneHits?.windows.L10.hitRate ?? null, 0)}</td>
                            <td>{formatPercent(milestoneHits?.windows.L20.hitRate ?? null, 0)}</td>
                            <td>{formatAmerican(milestone.best.odds)}</td>
                            <td className="faint">{vendorLabel(milestone.best.vendor)}</td>
                            <td>
                              <AddToSlipButton pick={buildMilestonePick(game, playerId, playerName, summary.propType, milestone.threshold, props, gameOdds, "player page")} label="+" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const propOrder: Record<string, true> = { points: true, rebounds: true, assists: true, threes: true, points_rebounds_assists: true, points_rebounds: true, points_assists: true, rebounds_assists: true, steals: true, blocks: true, points_1q: true, rebounds_1q: true, assists_1q: true };
