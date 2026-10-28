"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { useVisiblePolling } from "@/lib/client/hooks";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { bestBetRule, bestBetTag, checkpointLabels, picksPerCheckpoint, type Checkpoint, chanceBucketLabel, evBucketLabel, groupLiveBets, summarizeLiveBets, type LiveBetPick, type LiveNight, type LiveRecordSummary } from "@/lib/live/liveBets";

interface LiveBetsResponse {
  status: { date: string; state: LiveNight["state"]; updatedAt: string; picks: number; liveGames: number; note: string | null } | null;
  night: LiveNight | null;
  picks: LiveBetPick[];
}

type RecordScope = "best" | "all";

const recordGroupings: Array<{ title: string; keyOf: (pick: LiveBetPick) => string | string[] }> = [
  { title: "Market", keyOf: (pick) => pick.label },
  { title: "Side", keyOf: (pick) => (pick.side === "over" ? "Over" : "Under") },
  { title: "EV", keyOf: (pick) => evBucketLabel(pick.evPercent) },
  { title: "Chance", keyOf: (pick) => chanceBucketLabel(pick.modelProbability) },
  { title: "Checkpoint", keyOf: (pick) => (pick.checkpoint ? checkpointLabels[pick.checkpoint] : "Unknown") },
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
  const status = pick.result?.status ?? null;
  const resultClass = status === "win" ? "positive" : status === "loss" ? "negative" : "";
  return (
    <li className="live-prop">
      <div className="live-prop-title">
        <span className="strong">{pick.playerName}</span> {pick.side === "over" ? "o" : "u"}
        {pick.line} <span className="muted">{pick.label}</span> <span className="faint small">· {pick.clockLabel}</span>
      </div>
      {status ? (
        <span className={`pill ${resultClass}`}>{status === "void" ? "Void" : `${status.toUpperCase()} · ${pick.result?.actual}`}</span>
      ) : (
        <span className="pill positive">
          {americanLabel(pick.americanOdds)} · {formatNumber(pick.evPercent, 1)}%
        </span>
      )}
      <div className="live-prop-why">
        <div className={`meter${status === "loss" ? " lost" : !status && pick.side === "under" ? " under" : ""}`}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="faint small tabular">
          {status ? `final ${pick.result?.actual ?? "-"}` : `${pick.latestValue} of ${pick.line}`} · {pick.vendor} · {formatPercent(pick.modelProbability, 0)} · {pick.matchup}
        </span>
      </div>
    </li>
  );
}

export default function LiveBetsPage() {
  const liveBets = useVisiblePolling(loadLiveBets, 60_000, "live-bets");
  const [recordScope, setRecordScope] = useState<RecordScope>("best");
  const [checkpointFilter, setCheckpointFilter] = useState<"all" | Checkpoint>("all");
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [groupingTitle, setGroupingTitle] = useState(recordGroupings[0].title);
  const activeGrouping = recordGroupings.find((grouping) => grouping.title === groupingTitle) ?? recordGroupings[0];
  const response = liveBets.data;
  const tonightDate = response?.status?.date ?? null;
  const allPicks = (response?.picks ?? []).filter((pick) => pick.checkpoint); // picks saved before checkpoints are left out of the record
  const nightDates = [...new Set([...(tonightDate ? [tonightDate] : []), ...allPicks.map((pick) => pick.gameDate)])].sort().reverse();
  const shownDate = chosenDate ?? nightDates[0] ?? null;
  const nightPicks = allPicks
    .filter((pick) => pick.gameDate === shownDate && (checkpointFilter === "all" || pick.checkpoint === checkpointFilter))
    .sort((first, second) => (checkpointFilter === "all" ? Number(second.tags.includes(bestBetTag)) - Number(first.tags.includes(bestBetTag)) : 0) || second.evPercent - first.evPercent); // best bets first, then by edge
  const gamesWithPicks = new Set(nightPicks.map((pick) => pick.gameId)).size;
  const scopedPicks = recordScope === "best" ? allPicks.filter((pick) => pick.tags.includes(bestBetTag)) : allPicks;
  const graded = scopedPicks.filter((pick) => pick.result);
  const overall = summarizeLiveBets(scopedPicks);

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Live Bets</h1>
          <p>
            Recorded on GitHub during games, page open or not · the top {picksPerCheckpoint} plays per game at the end of Q1, halftime and the end of Q3 · best bets {bestBetRule.minimumEvPercent}%+ EV and {Math.round(bestBetRule.minimumModelProbability * 100)}%+ chance
          </p>
        </div>
        <div className="row wrap">
          {trackerPill(response)}
          <span className="faint small">{response?.status ? `updated ${minutesAgoLabel(response.status.updatedAt)}` : liveBets.loading ? "Loading…" : ""}</span>
        </div>
      </div>
      {response?.status?.note ? <p className="faint small" style={{ marginTop: 0 }}>{response.status.note}</p> : null}
      {liveBets.error ? <p className="notice">{liveBets.error}</p> : null}
      {response?.night && response.night.games.length > 0 ? (
        <div className="chip-row" style={{ marginBottom: 12 }}>
          {response.night.games.map((game) => (
            <span key={game.gameId} className="pill">
              {game.matchup} {game.homeScore + game.visitorScore > 0 ? `${game.visitorScore}-${game.homeScore}` : ""} <span className="faint">{/^\d{4}-/.test(game.status) ? "Scheduled" : game.status}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>Picks</h2>
        <div className="row wrap">
          {nightDates.length > 1 ? (
            <select className="input night-select" value={shownDate ?? ""} onChange={(changeEvent) => setChosenDate(changeEvent.target.value)} aria-label="Night">
              {nightDates.map((nightDate) => (
                <option key={nightDate} value={nightDate}>
                  {nightDate === tonightDate ? "Tonight" : new Date(`${nightDate}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                </option>
              ))}
            </select>
          ) : null}
          <Segmented
            label="Checkpoint"
            options={[
              { value: "all", label: "All" },
              { value: "end-q1", label: "End Q1" },
              { value: "halftime", label: "Half" },
              { value: "end-q3", label: "End Q3" },
            ]}
            value={checkpointFilter}
            onChange={setCheckpointFilter}
          />
        </div>
      </div>
      <section className="card flush">
        <div className="live-top-head" style={{ paddingBottom: 8 }}>
          <h3>{checkpointFilter === "all" ? "Best bets first" : checkpointLabels[checkpointFilter]}</h3>
          <span className="faint small">
            {nightPicks.length} picks · {nightPicks.filter((pick) => pick.tags.includes(bestBetTag)).length} best · {gamesWithPicks} games
          </span>
        </div>
        {nightPicks.length === 0 ? <p className="live-top-note faint small" style={{ marginTop: 0 }}>{checkpointFilter === "all" ? "No picks yet. They are saved at the end of Q1, halftime and the end of Q3 of each game." : `No ${checkpointLabels[checkpointFilter]} picks yet.`}</p> : null}
        {checkpointFilter === "all" ? (
          <ul className="live-bet-list">
            {nightPicks.map((pick) => (
              <PickRow key={pick.pickId} pick={pick} />
            ))}
          </ul>
        ) : (
          [...new Set(nightPicks.map((pick) => pick.matchup))].map((matchup) => (
            <div key={matchup}>
              <div className="pick-group-head">{matchup}</div>
              <ul className="live-bet-list">
                {nightPicks
                  .filter((pick) => pick.matchup === matchup)
                  .map((pick) => (
                    <PickRow key={pick.pickId} pick={pick} />
                  ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <div className="section-head">
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
          <div className="kpi-label">{overall.pending} pending</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{formatPercent(overall.winRate, 1)}</div>
          <div className="kpi-label">Win rate · model {formatPercent(overall.averageModel, 1)}</div>
        </div>
        <div className="kpi">
          <div className={`kpi-value ${overall.units >= 0 ? "positive" : "negative"}`}>{formatSigned(overall.units, 1)}u</div>
          <div className="kpi-label">ROI {formatSigned(overall.roiPercent, 1)}%</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{new Set(allPicks.map((pick) => pick.gameDate)).size}</div>
          <div className="kpi-label">Nights tracked</div>
        </div>
      </div>
      <p className="faint small">If the win rate keeps landing near what the model said, the edges are real. Each pick is graded at the price seen at its break; a player and market is picked at most once per game.</p>
      {graded.length === 0 ? <p className="faint small">Nothing graded yet.</p> : (
        <>
          <Segmented label="Break down by" options={recordGroupings.map((grouping) => ({ value: grouping.title, label: grouping.title }))} value={groupingTitle} onChange={setGroupingTitle} />
          <div className="card flush" style={{ marginTop: 10 }}>
            <div className="table-scroll" style={{ margin: 0, padding: 0 }}>
              <table className="data-table record-table">
                <thead>
                  <tr>
                    <th>{activeGrouping.title}</th>
                    <th>Record</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {groupLiveBets(scopedPicks, activeGrouping.keyOf)
                    .sort((first, second) => (activeGrouping.title === "Night" ? second.key.localeCompare(first.key) : second.summary.picks - first.summary.picks))
                    .map((group) => (
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
          </div>
        </>
      )}
    </main>
  );
}
