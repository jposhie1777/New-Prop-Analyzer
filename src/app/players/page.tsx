"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { TeamLogo } from "@/components/TeamLogo";
import { useAnalytics } from "@/lib/client/hooks";
import { searchPlayers, type PlayerProfile } from "@/lib/analytics/aggregates/playerAggregates";
import { fetchApi } from "@/lib/client/apiClient";
import type { BdlPlayer } from "@/lib/bdl/types";

type SearchResult = PlayerProfile & { games: number };

export default function PlayersPage() {
  const { handle, status } = useAnalytics();
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = searchText.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        let found: SearchResult[] = handle ? await searchPlayers(handle.engine, trimmed) : [];
        if (found.length === 0 && (trimmed.length >= 3 || !handle)) {
          const body = await fetchApi<{ data: BdlPlayer[] }>(`/api/players?search=${encodeURIComponent(trimmed)}`); // fall back to BDL for players with no games yet
          found = (body.data ?? []).map((player) => ({ player_id: player.id, first_name: player.first_name, last_name: player.last_name, position: player.position, team_id: player.team?.id ?? null, jersey_number: player.jersey_number, games: 0 }));
        }
        if (!cancelled) setResults(found);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250); // debounce typing
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText, handle]);

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Players</h1>
          <p>Game logs, quarter splits, hit rates and matchups for any player.</p>
        </div>
      </div>
      <input className="input" placeholder={status.phase === "ready" ? "Search players…" : "Search players (data still syncing)…"} value={searchText} onChange={(changeEvent) => setSearchText(changeEvent.target.value)} autoFocus />
      <div className="stack" style={{ marginTop: 12, gap: 0 }}>
        {!handle ? <div className="faint small">Loading your local stats ({status.message}). Search still works meanwhile.</div> : null}
        {searching ? <div className="faint small">Searching…</div> : null}
        {results.map((result) => (
          <Link key={result.player_id} href={`/player/${result.player_id}`} className="player-result">
            <PlayerHeadshot playerId={result.player_id} firstName={result.first_name} lastName={result.last_name} />
            <div style={{ flex: 1 }}>
              <div className="strong">
                {result.first_name} {result.last_name}
              </div>
              <div className="faint small">
                {result.position || "-"} · {handle ? `${Number(result.games)} games logged` : "from BALLDONTLIE"}
              </div>
            </div>
            {result.team_id ? <TeamLogo teamId={result.team_id} /> : null}
          </Link>
        ))}
        {searchText.trim().length >= 2 && !searching && results.length === 0 ? <div className="card empty-state">No players found.</div> : null}
      </div>
    </main>
  );
}
