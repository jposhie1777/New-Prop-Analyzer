"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAnalytics, useTracked } from "@/lib/client/hooks";
import { matchBoxScore, useLiveBoxScores, useSlate } from "@/lib/client/slateData";
import { readPlacedBets, removePlacedBet, subscribePlacedBets, type PlacedBet } from "@/lib/client/placedBets";
import { betState, legProgress, type LegProgress, type LegState } from "@/lib/tracking/betProgress";
import { gradePendingPicks } from "@/lib/tracking/grader";
import { saveGrades } from "@/lib/tracking/trackerStore";
import { formatAmerican } from "@/lib/math/odds";
import { vendorLabel } from "@/lib/odds/deeplinks";
import { todayEastern } from "@/lib/dates";

const emptyBets: PlacedBet[] = [];
let cachedBets: PlacedBet[] | null = null;

function betsSnapshot(): PlacedBet[] {
  cachedBets ??= readPlacedBets();
  return cachedBets;
}

export function usePlacedBets(): PlacedBet[] {
  return useSyncExternalStore(
    (onChange) =>
      subscribePlacedBets((bets) => {
        cachedBets = bets;
        onChange();
      }),
    betsSnapshot,
    () => emptyBets,
  );
}

const stateLabels: Record<LegState, string> = { upcoming: "Not started", live: "Live", win: "Won", loss: "Lost", push: "Push", void: "Void", waiting: "Waiting" };

function statePill(state: LegState) {
  const tone = state === "win" ? " positive" : state === "loss" ? " negative" : state === "live" ? " live" : "";
  return (
    <span className={`pill${tone}`}>
      {state === "live" ? <span className="live-dot" /> : null}
      {stateLabels[state]}
    </span>
  );
}

function LegRow({ label, detail, progress, under }: { label: string; detail: string; progress: LegProgress; under: boolean }) {
  const tone = progress.state === "win" ? "positive" : progress.state === "loss" ? "negative" : progress.onTrack === true ? "positive" : progress.onTrack === false ? "negative" : "";
  return (
    <div className="bet-leg">
      <div className="bet-leg-top">
        <span className="bet-leg-label">
          <span className="strong">{label}</span> <span className="faint small">{detail}</span>
        </span>
        <span className={`small strong ${tone}`}>{progress.text}</span>
      </div>
      {progress.fraction !== null ? (
        <div className={`meter${progress.state === "loss" ? " lost" : under && progress.state === "live" ? " under" : ""}`}>
          <span style={{ width: `${progress.fraction * 100}%` }} />
        </div>
      ) : null}
      <span className="faint small">{progress.clock ?? stateLabels[progress.state]}</span>
    </div>
  );
}

export function MyBets() {
  const bets = usePlacedBets();
  const tracked = useTracked();
  const { handle } = useAnalytics();
  const slate = useSlate();
  const games = slate.data?.games ?? null;
  const live = useLiveBoxScores(games);
  const trackedById = new Map(tracked.map((pick) => [pick.trackId, pick]));

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    gradePendingPicks(handle.engine, tracked.filter((pick) => pick.source === "slip"), todayEastern()).then(
      (graded) => !cancelled && graded.length > 0 && saveGrades(graded),
      () => undefined,
    ); // past days are graded from final stats, the same as the Record page
    return () => {
      cancelled = true;
    };
  }, [handle, tracked.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = bets.map((bet) => {
    const legs = bet.legs.map((leg) => {
      const game = (games ?? []).find((candidate) => candidate.id === leg.gameId) ?? null;
      const boxScore = game ? matchBoxScore(game, live.boxScores) : null;
      return { leg, progress: legProgress(leg, game, boxScore, trackedById.get(`slip-${leg.pickId}`) ?? null) };
    });
    return { bet, legs, state: betState(legs.map((entry) => entry.progress.state)) };
  });
  const open = rows.filter((row) => row.state === "live" || row.state === "upcoming" || row.state === "waiting");
  const settled = rows.filter((row) => !open.includes(row));
  const count = (state: LegState) => rows.filter((row) => row.state === state).length;

  if (bets.length === 0) {
    return <div className="card empty-state">No bets tracked yet. Bets show up here when you copy them, open them at a book or send them to GamblyBot from the slip.</div>;
  }

  const renderBet = ({ bet, legs, state }: (typeof rows)[number]) => (
    <article key={bet.betId} className="card flush bet-card">
      <div className="bet-card-head">
        <div>
          <span className="strong">{bet.type === "parlay" ? `Parlay · ${bet.legs.length} legs` : "Single"}</span>
          <span className="faint small">
            {" "}
            · {bet.americanOdds !== null ? formatAmerican(bet.americanOdds) : "-"}
            {bet.vendor ? ` · ${vendorLabel(bet.vendor)}` : ""} · {new Date(bet.placedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        </div>
        <span className="row" style={{ gap: 6 }}>
          {statePill(state)}
          <button className="icon-button" onClick={() => removePlacedBet(bet.betId)} aria-label="Stop tracking this bet">
            ✕
          </button>
        </span>
      </div>
      {legs.map(({ leg, progress }) => (
        <LegRow key={leg.pickId} label={leg.label} detail={leg.detail} progress={progress} under={leg.selectionKey === "under" || leg.selectionKey === "total_under"} />
      ))}
    </article>
  );

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-value">{count("live")}</div>
          <div className="kpi-label">Live now</div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{count("upcoming") + count("waiting")}</div>
          <div className="kpi-label">Not started or waiting</div>
        </div>
        <div className="kpi">
          <div className="kpi-value positive">{count("win")}</div>
          <div className="kpi-label">Won</div>
        </div>
        <div className="kpi">
          <div className="kpi-value negative">{count("loss")}</div>
          <div className="kpi-label">Lost</div>
        </div>
      </div>
      {live.lastUpdated ? <span className="faint small">Scores update every 30 s while games are live.</span> : null}
      {open.map(renderBet)}
      {settled.length > 0 ? <h2 className="record-subhead">Settled</h2> : null}
      {settled.map(renderBet)}
    </div>
  );
}
