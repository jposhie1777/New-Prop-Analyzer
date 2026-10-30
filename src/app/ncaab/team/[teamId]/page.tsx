"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { NcaabBoxScore, PlayerAveragesTable, RatingHead, RatingRow } from "@/components/ncaab/NcaabParts";
import { Segmented } from "@/components/Segmented";
import { useNcaabRatings, useNcaabTeamFile } from "@/lib/client/ncaabData";
import { formatNumber, formatPercent } from "@/lib/client/format";

export default function NcaabTeamPage() {
  const params = useParams<{ teamId: string }>();
  const teamId = Number(params.teamId);
  const ratings = useNcaabRatings();
  const teamFile = useNcaabTeamFile(Number.isFinite(teamId) ? teamId : null);
  const [openGame, setOpenGame] = useState<number | null>(null);
  const team = ratings.data?.teams.find((candidate) => candidate.id === teamId) ?? null;
  const teamsById = new Map((ratings.data?.teams ?? []).map((candidate) => [candidate.id, candidate]));
  const seasons = [...new Set((teamFile.data?.games ?? []).map((game) => game.season))].sort((first, second) => second - first);
  const [season, setSeason] = useState<number | null>(null);
  const shownSeason = season ?? seasons[0] ?? ratings.data?.season ?? null;
  const games = (teamFile.data?.games ?? []).filter((game) => game.season === shownSeason);
  const averages = (teamFile.data?.playerAverages ?? []).filter((average) => average.season === shownSeason);
  const seasonLabel = (seasonNumber: number) => `${seasonNumber}-${String(seasonNumber + 1).slice(2)}`;

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>
            {team?.apRank ? <span className="rank-badge">#{team.apRank}</span> : null}
            {team ? `${team.college} ${team.name}` : `Team ${params.teamId}`}
          </h1>
          <p>
            {team ? `${team.conference ?? "Independent"} · ${team.wins}-${team.losses} · net rank ${team.netRank ?? "-"} · ID ${team.id}` : ratings.loading ? "Loading..." : "Not in the ratings yet."}
            {team?.returningShare !== null && team?.returningShare !== undefined ? ` · ${formatPercent(team.returningShare, 0)} of last season's scoring returned` : ""}
          </p>
        </div>
        <Link href="/ncaab/teams" className="button ghost small">
          All teams
        </Link>
      </div>
      {team && ratings.data ? (
        <div className="card flush table-scroll" style={{ marginBottom: 12 }}>
          <table className="data-table">
            <RatingHead />
            <tbody>
              <RatingRow label="Model (blended)" rating={team.blended} league={ratings.data.league} />
              {team.season ? <RatingRow label="This season" rating={team.season} league={ratings.data.league} /> : null}
              {team.prior ? <RatingRow label="From last season" rating={team.prior} league={ratings.data.league} /> : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {seasons.length > 1 ? (
        <div style={{ marginBottom: 12 }}>
          <Segmented label="Season" options={seasons.map((seasonNumber) => ({ value: seasonNumber, label: seasonLabel(seasonNumber) }))} value={shownSeason ?? seasons[0]} onChange={setSeason} />
        </div>
      ) : null}
      {teamFile.loading ? <div className="skeleton" style={{ minHeight: 200 }} /> : null}
      {!teamFile.loading && !teamFile.data ? <div className="card empty-state">No games for this team yet.</div> : null}
      {teamFile.data ? (
        <>
          <h2 className="section-title">Player averages {shownSeason ? seasonLabel(shownSeason) : ""}</h2>
          <div className="card flush" style={{ marginBottom: 12 }}>
            <PlayerAveragesTable averages={averages} />
          </div>
          <h2 className="section-title">Game log</h2>
          <div className="card flush">
            {games.map((game) => {
              const opponent = teamsById.get(game.opponentId);
              const won = game.scored > game.allowed;
              const open = openGame === game.gameId;
              return (
                <div key={game.gameId} className="ledger-item">
                  <div className="result-row" role="button" tabIndex={0} onClick={() => setOpenGame(open ? null : game.gameId)} onKeyDown={(keyEvent) => (keyEvent.key === "Enter" || keyEvent.key === " ") && setOpenGame(open ? null : game.gameId)} aria-expanded={open}>
                    <span style={{ minWidth: 0 }}>
                      <span className="faint small tabular">{new Date(`${game.date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })} </span>
                      <span className="faint">{game.neutral ? "vs" : game.atHome ? "vs" : "@"} </span>
                      {opponent?.apRank ? <span className="rank-badge">#{opponent.apRank}</span> : null}
                      <Link href={`/ncaab/team/${game.opponentId}`} onClick={(clickEvent) => clickEvent.stopPropagation()} className="strong">
                        {opponent?.college ?? `Team ${game.opponentId}`}
                      </Link>
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={`pill ${won ? "positive" : "negative"}`}>
                        {won ? "W" : "L"} {game.scored}-{game.allowed}
                      </span>
                      <span className="faint small hide-narrow">{game.possessions !== null ? `${formatNumber(game.possessions, 0)} poss` : ""}</span>
                      <span className="ledger-chevron">{open ? "▲" : "▼"}</span>
                    </span>
                  </div>
                  {open ? <div className="ledger-extra">{game.boxAvailable ? <NcaabBoxScore gameId={game.gameId} /> : <p className="faint small">No play-by-play for this game yet.</p>}</div> : null}
                </div>
              );
            })}
            {games.length === 0 ? <div className="empty-state">No finished games this season yet.</div> : null}
          </div>
        </>
      ) : null}
    </main>
  );
}
