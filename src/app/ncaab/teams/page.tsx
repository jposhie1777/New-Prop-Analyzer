"use client";

import Link from "next/link";
import { useState } from "react";
import { matchesTeamSearch } from "@/components/ncaab/NcaabParts";
import { useNcaabRatings } from "@/lib/client/ncaabData";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";

type TeamSort = "net" | "offense" | "defense" | "tempo" | "ap";

export default function NcaabTeamsPage() {
  const ratings = useNcaabRatings();
  const [search, setSearch] = useState("");
  const [topOnly, setTopOnly] = useState(false);
  const [sortKey, setSortKey] = useState<TeamSort>("net");
  const league = ratings.data?.league;
  const teams = (ratings.data?.teams ?? [])
    .filter((team) => (!topOnly || team.apRank !== null) && matchesTeamSearch(search, team))
    .sort((first, second) => {
      if (sortKey === "ap") return (first.apRank ?? 99) - (second.apRank ?? 99) || (first.netRank ?? 999) - (second.netRank ?? 999);
      if (sortKey === "offense") return second.blended.offense - first.blended.offense;
      if (sortKey === "defense") return first.blended.defense - second.blended.defense;
      if (sortKey === "tempo") return second.blended.tempo - first.blended.tempo;
      return (first.netRank ?? 999) - (second.netRank ?? 999);
    });
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>College teams</h1>
          <p>Opponent-adjusted ratings built from play-by-play box scores, this season blended with last season. {ratings.data ? `Updated ${new Date(ratings.data.generatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : ""}</p>
        </div>
      </div>
      <div className="ncaab-search">
        <input className="input" type="search" placeholder="Search a team name or ID" value={search} onChange={(changeEvent) => setSearch(changeEvent.target.value)} aria-label="Search teams" />
        <label className="row small strong" style={{ gap: 6 }}>
          <input type="checkbox" checked={topOnly} onChange={(changeEvent) => setTopOnly(changeEvent.target.checked)} />
          Top 25 only
        </label>
        <label className="small muted lines-sort">
          Sort
          <select className="input" value={sortKey} onChange={(changeEvent) => setSortKey(changeEvent.target.value as TeamSort)}>
            <option value="net">Net rating</option>
            <option value="ap">AP rank</option>
            <option value="offense">Offense</option>
            <option value="defense">Defense</option>
            <option value="tempo">Tempo</option>
          </select>
        </label>
      </div>
      {ratings.loading ? <div className="skeleton" style={{ minHeight: 300 }} /> : null}
      {!ratings.loading && !ratings.data ? <div className="notice">No ratings yet. They appear after the first NCAAB nightly data run.</div> : null}
      {ratings.data && league ? (
        <div className="card flush table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>ID</th>
                <th>AP</th>
                <th>Rk</th>
                <th>W-L</th>
                <th>Off</th>
                <th>Def</th>
                <th>Net</th>
                <th>Tempo</th>
                <th>Returning</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <Link href={`/ncaab/team/${team.id}`} className="strong">
                      {team.college}
                    </Link>
                    <span className="sub">{team.conference ?? ""}</span>
                  </td>
                  <td className="faint">{team.id}</td>
                  <td>{team.apRank ?? ""}</td>
                  <td>{team.netRank ?? "-"}</td>
                  <td>
                    {team.wins}-{team.losses}
                  </td>
                  <td>{formatNumber(team.blended.offense, 1)}</td>
                  <td>{formatNumber(team.blended.defense, 1)}</td>
                  <td className="strong">{formatSigned(team.blended.offense - team.blended.defense, 1)}</td>
                  <td>{formatNumber(team.blended.tempo, 1)}</td>
                  <td>{formatPercent(team.returningShare, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {teams.length === 0 ? <div className="empty-state">No teams match.</div> : null}
        </div>
      ) : null}
    </main>
  );
}
