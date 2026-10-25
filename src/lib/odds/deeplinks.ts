import type { BdlDeeplink, BdlDeeplinks } from "@/lib/bdl/types";
import { sportsbookNbaPages } from "@/config/sportsbookLinks";

export interface LinkSettings {
  sportsbookState: string;
  wagerAmount: number;
  pickType: string;
}

export interface ResolvedLink {
  href: string;
  kind: "selection" | "event" | "book";
}

export function bookHomeLink(vendor: string, settings: LinkSettings): ResolvedLink | null {
  const template = sportsbookNbaPages[vendor];
  if (!template) return null;
  return { href: template.replace(/\{state\}/g, encodeURIComponent(settings.sportsbookState.toLowerCase())), kind: "book" }; // last resort: the book's NBA page
}

export const vendorLabels: Record<string, string> = {
  fanduel: "FanDuel",
  draftkings: "DraftKings",
  betmgm: "BetMGM",
  caesars: "Caesars",
  betrivers: "BetRivers",
  betway: "Betway",
  ballybet: "Bally Bet",
  betparx: "betPARX",
  rebet: "Rebet",
  espnbet: "ESPN BET",
  fanatics: "Fanatics",
  bet365: "bet365",
  kalshi: "Kalshi",
  polymarket: "Polymarket",
};

export const copyOnlyPropVendors = new Set(["fanduel", "draftkings"]); // no prop deeplinks from BDL: link the event and copy the pick

export function vendorLabel(vendor: string): string {
  return vendorLabels[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

export function fillTemplate(link: BdlDeeplink | null | undefined, settings: LinkSettings): string | null {
  if (!link) return null;
  if (link.url) return link.url;
  if (!link.url_template) return null;
  const filled = link.url_template
    .replace(/\{state\}/g, encodeURIComponent(settings.sportsbookState.toLowerCase()))
    .replace(/\{wagerAmount\}/g, encodeURIComponent(String(settings.wagerAmount)))
    .replace(/\{pickType\}/g, encodeURIComponent(settings.pickType));
  if (/\{[A-Za-z_]+\}/.test(filled)) return null; // an unknown placeholder would make a broken link
  return /^https:\/\//.test(filled) ? filled : null;
}

export function resolveSelectionLink(deeplinks: BdlDeeplinks | null | undefined, selectionKey: string, settings: LinkSettings, fallbackEvent?: BdlDeeplinks | null): ResolvedLink | null {
  const selectionHref = fillTemplate(deeplinks?.selections?.[selectionKey], settings);
  if (selectionHref) return { href: selectionHref, kind: "selection" };
  const eventHref = fillTemplate(deeplinks?.event, settings) ?? fillTemplate(fallbackEvent?.event, settings);
  return eventHref ? { href: eventHref, kind: "event" } : null;
}

export function resolvePropLink(vendor: string, propDeeplinks: BdlDeeplinks | null | undefined, side: "over" | "under" | "yes", settings: LinkSettings, gameOddDeeplinks?: BdlDeeplinks | null): ResolvedLink | null {
  if (copyOnlyPropVendors.has(vendor)) {
    const eventHref = fillTemplate(propDeeplinks?.event, settings) ?? fillTemplate(gameOddDeeplinks?.event, settings);
    return eventHref ? { href: eventHref, kind: "event" } : null;
  }
  return resolveSelectionLink(propDeeplinks, side, settings, gameOddDeeplinks);
}
