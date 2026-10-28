"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { useVisiblePolling } from "@/lib/client/hooks";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { bestBetRule, bestBetTag, liveBetMinimumEvPercent, chanceBucketLabel, evBucketLabel, groupLiveBets, summarizeLiveBets, type LiveBetPick, type LiveNight, type LiveRecordSummary } from "@/lib/live/liveBets";

interface LiveBetsResponse {
  status: { date: string; state: LiveNight["state"]; updatedAt: string; picks: number; liveGames: number; note: string | null } | null;
  night: LiveNight | null;
  picks: LiveBetPick[];
}

type RecordScope = "best" | "all";

const shownBestBets = 5; // the rest sit behind a button

const recordGroupings: Array<{ title: string; keyOf: (pick: LiveBetPick) => string | string[] }> = [
  { title: "Market", keyOf: (pick) => pick.label },
  { title: "Side", keyOf: (pick) => (pick.side === "over" ? "Over" : "Under") },
  { title: "Claimed EV", keyOf: (pick) => evBucketLabel(pick.evPercent) },
  { title: "Model chance", keyOf: (pick) => chanceBucketLabel(pick.modelProbability) },
  { title: "When found", keyOf: (pick) => pick.tags.find((tag) => tag === "Halftime" || tag.startsWith("Found in")) ?? "Unknown" },
  { title: "Situation", keyOf: (pick) => pick.tags.filter((tag) => ["Blowout risk", "Foul trouble", "Cold shooter", "Hot shooter", "Already 60%+ of line", "Under 60% of line"].includes(tag)) },
  { title: "Night", keyOf: (pick) => pick.gameDate },
];

async function loadLiveBets(): Promise<LiveBetsResponse> {
  const response = await fetch("/api/live-bets");
  if (!response.ok) throw new Error(`Live bets failed (${response.status})`);
  return (await response.json()) as LiveBetsResponse;
}

function americanLabel(americanOdds: number): string {
  return americanOdds > 0 ? `+${americanOdds}` : String(americanOdds);
}

function minutesAgoLabel(isoTime: string): string {
  const minutesAgo = Math.max(0, Math.round((Date.now() - Date.parse(isoTime)) / 60_000));
  if (minutesAgo < 1) return "just now";
  if (minutesAgo < 90) return `${minutesAgo} min ago`;
  return `${Math.round(minutesAgo / 60)} h ago`;
}

function SummaryCell({ summary }: { summary: LiveRecordSummary }) {
  if (summary.wins + summary.losses + summary.pushes === 0) return <span className="faint">{summary.pending > 0 ? `${summary.pending} pending` : "–"}</span>;
  return (
    <span className="record-cell">
      <span className="strong">
        {summary.wins}-{summary.losses}
        {summary.pushes > 0 ? `-${summary.pushes}` : ""}
      </span>
      <span className="faint"> {formatPercent(summary.winRate, 0)}</span>
      <span className={`record-units ${summary.units >= 0 ? "positive" : "negative"}`}>{formatSigned(summary.units, 1)}u</span>
    </span>
  );
}

function trackerPill(response: LiveBetsResponse | null) {
  const status = response?.status;
  if (!status) return <span className="pill">Tracker has not run yet</span>;
  const stale = Date.now() - Date.parse(status.updatedAt) > 15 * 60_000;
  if (status.state === "running" && !stale)
    return (
      <span className="pill live">
        <span className="live-dot" /> Tracking {status.liveGames} live game{status.liveGames === 1 ? "" : "s"}
      </span>
    );
  if (status.state === "waiting") return <span className="pill accent">Waiting for tip-off</span>;
  if (status.state === "done") return <span className="pill positive">Done for the night</span>;
  return <span className="pill warning">Idle</span>;
}

function PickRow({ pick }: { pick: LiveBetPick }) {
  const progress = Math.min(1, pick.latestValue / Math.max(pick.line, 0.5));
  const resultClass = pick.result?.status === "win" ? "positive" : pick.result?.status === "loss" ? "negative" : "";
  return (
    <li className="live-bet-row">
      <div className="row-between" style={{ gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="strong live-bet-name">
            {pick.playerName} {pick.side === "over" ? "o" : "u"}
            {pick.line} {pick.label}
          </div>
          <div className="faint small">
            {pick.teamAbbreviation} · {pick.matchup} · found {pick.clockLabel} with {pick.valueAtPick}
          </div>
        </div>
        <div className="live-bet-numbers">
          <div className="strong">
            {americanLabel(pick.americanOdds)} <span className="faint small">{pick.vendor}</span>
          </div>
          <div className="small">
            <span className="positive">{formatNumber(pick.evPercent, 1)}% EV</span> <span className="faint">· {formatPercent(pick.modelProbability, 0)}</span>
          </div>
        </div>
      </div>
      <div className="row-between small" style={{ gap: 8, marginTop: 6 }}>
        <div className="meter" style={{ flex: 1 }}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="live-bet-numbers">
          {pick.result ? <span className={`pill ${resultClass}`}>{pick.result.status === "void" ? "Void" : `${pick.result.status.toUpperCase()} · ${pick.result.actual}`}</span> : `${pick.latestValue} of ${pick.line}`}
        </span>
      </div>
    </li>
  );
}

export default function LiveBetsPage() {
  const liveBets = useVisiblePolling(loadLiveBets, 60_000, "live-bets");
  const [recordScope, setRecordScope] = useState<RecordScope>("best");
  const [showAllTonight, setShowAllTonight] = useState(false);
  const response = liveBets.data;
  const tonightDate = response?.status?.date ?? null;
  const allPicks = response?.picks ?? [];
  const tonightPicks = allPicks.filter((pick) => pick.gameDate === tonightDate);
  const rankedTonight = [...tonightPicks].sort((first, second) => Number(Boolean(first.result)) - Number(Boolean(second.result)) || Number(second.tags.includes(bestBetTag)) - Number(first.tags.includes(bestBetTag)) || second.evPercent - first.evPercent); // open best bets first
  const bestCount = tonightPicks.filter((pick) => pick.tags.includes(bestBetTag)).length;
  const topTonight = rankedTonight.filter((pick) => pick.tags.includes(bestBetTag)).slice(0, shownBestBets);
  const otherTonight = rankedTonight.filter((pick) => !topTonight.includes(pick));
  const scopedPicks = recordScope === "best" ? allPicks.filter((pick) => pick.tags.includes(bestBetTag)) : allPicks;
  const graded = scopedPicks.filter((pick) => pick.result);
  const overall = summarizeLiveBets(scopedPicks);

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Live Bets</h1>
          <p>
            Runs on GitHub during games, page open or not. Every minute it records the first {liveBetMinimumEvPercent}%+ edge per player and market, then grades it at the final. Best bets: {bestBetRule.minimumEvPercent}%+ EV and {Math.round(bestBetRule.minimumModelProbability * 100)}%+ model chance. Live prices move fast; check the price before betting.
          </p>
        </div>
      </div>

      <section className="card" style={{ marginTop: 0 }}>
        <div className="row-between wrap" style={{ gap: 8 }}>
          {trackerPill(response)}
          <span className="faint small">{response?.status ? `Updated ${minutesAgoLabel(response.status.updatedAt)} · ${response.status.date}` : liveBets.loading ? "Loading…" : ""}</span>
        </div>
        {response?.status?.note ? <p className="faint small" style={{ margin: "8px 0 0" }}>{response.status.note}</p> : null}
        {liveBets.error ? <p className="notice" style={{ marginTop: 8 }}>{liveBets.error}</p> : null}
        {response?.night && response.night.games.length > 0 ? (
          <div className="chip-row" style={{ marginTop: 10 }}>
            {response.night.games.map((game) => (
              <span key={game.gameId} className="pill">
                {game.matchup} {game.homeScore + game.visitorScore > 0 ? `${game.visitorScore}-${game.homeScore}` : ""} <span className="faint">{/^\d{4}-/.test(game.status) ? "Scheduled" : game.status}</span>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Best bets tonight</h2>
          <span className="faint small">{bestCount} best bets · {tonightPicks.length} edges</span>
        </div>
        {topTonight.length === 0 ? <p className="faint small">None yet. They show up here within a few minutes of being found.</p> : null}
        <ul className="live-bet-list">
          {topTonight.map((pick) => (
            <PickRow key={pick.pickId} pick={pick} />
          ))}
        </ul>
        {otherTonight.length > 0 ? (
          <>
            <button className="button" style={{ marginTop: 10 }} onClick={() => setShowAllTonight((shown) => !shown)}>
              {showAllTonight ? "Hide" : "Show"} {otherTonight.length} more
            </button>
            {showAllTonight ? (
              <ul className="live-bet-list" style={{ marginTop: 10 }}>
                {otherTonight.map((pick) => (
                  <PickRow key={pick.pickId} pick={pick} />
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header wrap">
          <h2>Record</h2>
          <Segmented
            label="Record scope"
            options={[
              { value: "best", label: "Best bets" },
              { value: "all", label: "All picks" },
            ]}
            value={recordScope}
            onChange={setRecordScope}
          />
        </div>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-value">
              {overall.wins}-{overall.losses}
              {overall.pushes > 0 ? `-${overall.pushes}` : ""}
            </div>
            <div className="kpi-label">Record ({overall.pending} pending)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{formatPercent(overall.winRate, 1)}</div>
            <div className="kpi-label">Win rate (model said {formatPercent(overall.averageModel, 1)})</div>
          </div>
          <div className="kpi">
            <div className={`kpi-value ${overall.units >= 0 ? "positive" : "negative"}`}>{formatSigned(overall.units, 1)}u</div>
            <div className="kpi-label">Units, 1 per pick</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{formatSigned(overall.roiPercent, 1)}%</div>
            <div className="kpi-label">ROI</div>
          </div>
        </div>
        <p className="faint small">If the win rate keeps landing near what the model said, the edges are real. Each player and market counts once per game, at the first price flagged.</p>
        {graded.length === 0 ? <p className="faint small">Nothing graded yet.</p> : null}
        {graded.length > 0
          ? recordGroupings.map((grouping) => {
              const groups = groupLiveBets(scopedPicks, grouping.keyOf).sort((first, second) => (grouping.title === "Night" ? second.key.localeCompare(first.key) : second.summary.picks - first.summary.picks));
              return (
                <div key={grouping.title} className="table-scroll" style={{ marginTop: 10 }}>
                  <table className="data-table record-table">
                    <thead>
                      <tr>
                        <th>{grouping.title}</th>
                        <th>Record</th>
                        <th>Model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group) => (
                        <tr key={group.key}>
                          <td className="strong">{group.key}</td>
                          <td>
                            <SummaryCell summary={group.summary} />
                          </td>
                          <td className="faint">{formatPercent(group.summary.averageModel, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          : null}
      </section>
    </main>
  );
}
