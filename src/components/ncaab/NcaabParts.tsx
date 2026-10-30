"use client";

import Link from "next/link";
import { useNcaabBox } from "@/lib/client/ncaabData";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import type { PlayerBox, TeamBox } from "@/lib/ncaab/boxScore";
import type { LeagueAverages, TeamRatingLine } from "@/lib/ncaab/ratings";
import type { PlayerAverage, RatedTeam } from "@/lib/ncaab/dataFiles";

export function TeamName({ teamId, college, rated, link = true }: { teamId: number; college: string; rated: RatedTeam | null; link?: boolean }) {
  const label = (
    <>
      {rated?.apRank ? <span className="rank-badge">#{rated.apRank}</span> : null}
      <span className="strong">{college}</span>
      {rated ? (
        <span className="faint small">
          {" "}
          {rated.wins}-{rated.losses}
        </span>
      ) : null}
    </>
  );
  return link ? (
    <Link href={`/ncaab/team/${teamId}`} onClick={(clickEvent) => clickEvent.stopPropagation()}>
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

export function RatingRow({ label, rating, league }: { label: string; rating: TeamRatingLine; league: LeagueAverages }) {
  return (
    <tr>
      <td className="strong">{label}</td>
      <td>
        {formatNumber(rating.offense, 1)}
        <span className="sub"> {formatSigned(rating.offense - league.efficiency, 1)}</span>
      </td>
      <td>
        {formatNumber(rating.defense, 1)}
        <span className="sub"> {formatSigned(rating.defense - league.efficiency, 1)}</span>
      </td>
      <td>{formatSigned(rating.offense - rating.defense, 1)}</td>
      <td>{formatNumber(rating.tempo, 1)}</td>
      <td>{rating.games}</td>
    </tr>
  );
}

export function RatingHead() {
  return (
    <thead>
      <tr>
        <th>Team</th>
        <th>Off</th>
        <th>Def</th>
        <th>Net</th>
        <th>Tempo</th>
        <th>GP</th>
      </tr>
    </thead>
  );
}

function shooting(made: number, attempted: number): string {
  return `${made}-${attempted}`;
}

function BoxRows({ lines, team }: { lines: PlayerBox[]; team: TeamBox }) {
  return (
    <>
      {lines.map((line) => (
        <tr key={`${line.teamId}-${line.name}`}>
          <td>{line.name}</td>
          <td className="strong">{line.points}</td>
          <td>{line.offensiveRebounds + line.defensiveRebounds}</td>
          <td>{line.assists}</td>
          <td>{shooting(line.fieldGoalsMade, line.fieldGoalsAttempted)}</td>
          <td>{shooting(line.threesMade, line.threesAttempted)}</td>
          <td>{shooting(line.freeThrowsMade, line.freeThrowsAttempted)}</td>
          <td>{line.steals}</td>
          <td>{line.blocks}</td>
          <td>{line.turnovers}</td>
          <td>{line.fouls}</td>
        </tr>
      ))}
      <tr className="strong">
        <td>Team</td>
        <td>{team.points}</td>
        <td>{team.offensiveRebounds + team.defensiveRebounds}</td>
        <td>{team.assists}</td>
        <td>{shooting(team.fieldGoalsMade, team.fieldGoalsAttempted)}</td>
        <td>{shooting(team.threesMade, team.threesAttempted)}</td>
        <td>{shooting(team.freeThrowsMade, team.freeThrowsAttempted)}</td>
        <td>{team.steals}</td>
        <td>{team.blocks}</td>
        <td>{team.turnovers}</td>
        <td>{team.fouls}</td>
      </tr>
    </>
  );
}

const boxHeaders = ["PTS", "REB", "AST", "FG", "3PT", "FT", "STL", "BLK", "TO", "PF"];

export function NcaabBoxScore({ gameId }: { gameId: number }) {
  const box = useNcaabBox(gameId);
  if (box.loading) return <div className="skeleton" style={{ minHeight: 120 }} />;
  if (!box.data) return <p className="faint small">No box score yet. It is rebuilt from the play-by-play the morning after the game.</p>;
  const sides = [
    { name: box.data.awayName, team: box.data.away },
    { name: box.data.homeName, team: box.data.home },
  ];
  return (
    <div className="stack" style={{ gap: 10 }}>
      {sides.map(({ name, team }) => (
        <div key={team.teamId} className="table-scroll">
          <table className="data-table box-table">
            <thead>
              <tr>
                <th>{name}</th>
                {boxHeaders.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <BoxRows lines={box.data!.players.filter((line) => line.teamId === team.teamId)} team={team} />
            </tbody>
          </table>
        </div>
      ))}
      <p className="faint small" style={{ margin: 0 }}>
        {formatNumber(box.data.possessions, 1)} possessions · rebuilt from play-by-play{box.data.quality.pointsMatch ? "" : " · does not fully match the final score, so the ratings skip this game"}
      </p>
    </div>
  );
}

export function PlayerAveragesTable({ averages }: { averages: PlayerAverage[] }) {
  if (averages.length === 0) return <p className="faint small">No player lines yet.</p>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>GP</th>
            <th>PTS</th>
            <th>REB</th>
            <th>AST</th>
            <th>3PM</th>
            <th>FG%</th>
            <th>3P%</th>
            <th>FT%</th>
            <th>STL</th>
            <th>BLK</th>
            <th>TO</th>
          </tr>
        </thead>
        <tbody>
          {averages.map((average) => (
            <tr key={`${average.playerId ?? average.name}-${average.season}`}>
              <td>{average.name}</td>
              <td>{average.games}</td>
              <td className="strong">{formatNumber(average.points, 1)}</td>
              <td>{formatNumber(average.rebounds, 1)}</td>
              <td>{formatNumber(average.assists, 1)}</td>
              <td>{formatNumber(average.threesMade, 1)}</td>
              <td>{formatPercent(average.fieldGoalPercent, 0)}</td>
              <td>{formatPercent(average.threePercent, 0)}</td>
              <td>{formatPercent(average.freeThrowPercent, 0)}</td>
              <td>{formatNumber(average.steals, 1)}</td>
              <td>{formatNumber(average.blocks, 1)}</td>
              <td>{formatNumber(average.turnovers, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function matchesTeamSearch(query: string, team: { id: number; college: string; full_name?: string; name?: string; abbreviation: string }): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  if (/^\d+$/.test(trimmed)) return String(team.id) === trimmed; // a team id
  return [team.college, team.full_name ?? "", team.name ?? "", team.abbreviation].some((text) => text.toLowerCase().includes(trimmed));
}
