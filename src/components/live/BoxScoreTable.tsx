"use client";

import Link from "next/link";
import { useState } from "react";
import { TeamLogo } from "@/components/TeamLogo";
import type { BdlBoxScoreTeam } from "@/lib/bdl/types";
import { parseMinutes } from "@/lib/dates";

const boxColumns = [
  { field: "min", label: "MIN" },
  { field: "pts", label: "PTS" },
  { field: "reb", label: "REB" },
  { field: "ast", label: "AST" },
  { field: "fg3m", label: "3PM" },
  { field: "stl", label: "STL" },
  { field: "blk", label: "BLK" },
  { field: "turnover", label: "TOV" },
  { field: "pf", label: "PF" },
  { field: "plus_minus", label: "+/-" },
] as const;

export function BoxScoreTable({ side }: { side: BdlBoxScoreTeam }) {
  const [sortField, setSortField] = useState<(typeof boxColumns)[number]["field"]>("pts");
  const sortValue = (boxPlayer: BdlBoxScoreTeam["players"][number]) => (sortField === "min" ? parseMinutes(boxPlayer.min) : Number(boxPlayer[sortField] ?? 0));
  const players = [...side.players].filter((boxPlayer) => parseMinutes(boxPlayer.min) > 0).sort((first, second) => sortValue(second) - sortValue(first));
  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <TeamLogo teamId={side.team.id} />
        <span className="strong">{side.team.full_name}</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              {boxColumns.map((column) => (
                <th key={column.field} onClick={() => setSortField(column.field)} style={{ cursor: "pointer", color: column.field === sortField ? "var(--text-primary)" : undefined }}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((boxPlayer) => (
              <tr key={boxPlayer.player.id}>
                <td>
                  <Link href={`/player/${boxPlayer.player.id}`}>
                    {boxPlayer.player.first_name.charAt(0)}. {boxPlayer.player.last_name}
                  </Link>
                  {(boxPlayer.pf ?? 0) >= 3 ? <span className="pill warning" style={{ marginLeft: 6 }}>{boxPlayer.pf} PF</span> : null}
                </td>
                {boxColumns.map((column) => (
                  <td key={column.field}>{column.field === "min" ? Math.round(parseMinutes(boxPlayer.min)) : (boxPlayer[column.field] ?? "-")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
