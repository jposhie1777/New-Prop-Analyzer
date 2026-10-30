"use client";

import { useEffect, useState } from "react";
import { readLocalJson, writeLocalJson } from "./safeStorage";

export type Sport = "nba" | "ncaab";

const sportStorageKey = "pulse-sport";
const sharedPaths = ["/slip", "/settings", "/costs", "/login"]; // pages both sports use

export function sportForPath(pathname: string): Sport | null {
  if (pathname === "/ncaab" || pathname.startsWith("/ncaab/")) return "ncaab";
  if (sharedPaths.some((sharedPath) => pathname.startsWith(sharedPath))) return null;
  return "nba";
}

export function rememberSport(sport: Sport): void {
  writeLocalJson(sportStorageKey, sport);
}

export function useSport(pathname: string): Sport {
  const fromPath = sportForPath(pathname);
  const [stored, setStored] = useState<Sport>("nba");
  useEffect(() => setStored(readLocalJson<Sport>(sportStorageKey, "nba") === "ncaab" ? "ncaab" : "nba"), []);
  useEffect(() => {
    if (fromPath) {
      rememberSport(fromPath); // the last sport browsed is the one shared pages show
      setStored(fromPath);
    }
  }, [fromPath]);
  return fromPath ?? stored;
}
