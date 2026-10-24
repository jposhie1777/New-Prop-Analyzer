"use client";

import { useEffect, useState } from "react";
import { headshotUrl, loadPersonIds } from "@/lib/client/images";
import { initialsFor } from "@/lib/nba/personNames";

export function PlayerHeadshot({ playerId, firstName, lastName, large = false }: { playerId: number; firstName: string; lastName: string; large?: boolean }) {
  const [personId, setPersonId] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadPersonIds().then((mapping) => {
      if (!cancelled) setPersonId(mapping[String(playerId)] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [playerId]);
  if (!personId || failed) return <span className={`headshot-fallback${large ? " large" : ""}`}>{initialsFor(firstName, lastName)}</span>; // initials fallback
  return <img className={`headshot${large ? " large" : ""}`} src={headshotUrl(personId)} alt={`${firstName} ${lastName}`} loading="lazy" onError={() => setFailed(true)} />;
}
