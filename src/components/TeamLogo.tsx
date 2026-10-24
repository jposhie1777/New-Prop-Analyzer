"use client";

import { useState } from "react";
import { teamById, teamLogoUrl } from "@/lib/nba/teams";

export function TeamLogo({ teamId, large = false }: { teamId: number; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const team = teamById(teamId);
  const logoUrl = teamLogoUrl(teamId);
  if (failed || !logoUrl) return <span className={`logo-fallback${large ? " large" : ""}`}>{team?.abbreviation ?? "?"}</span>; // abbreviation when the logo can't load
  return <img className={`team-logo${large ? " large" : ""}`} src={logoUrl} alt={team?.abbreviation ?? "team"} loading="lazy" onError={() => setFailed(true)} />;
}
