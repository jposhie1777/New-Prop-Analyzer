"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSettings, useSlip } from "@/lib/client/hooks";
import { choosePickVendor, clearSlip, copyTextFor, removePick, selectedOffer, type SlipOffer, type SlipPick } from "@/lib/client/betSlip";
import { bookHomeLink, resolvePropLink, resolveSelectionLink, vendorLabel, type ResolvedLink } from "@/lib/odds/deeplinks";
import { americanToDecimal, expectedValuePercent, formatAmerican, kellyFraction, parlayAmericanOdds, parlayDecimalOdds, parlayProbability } from "@/lib/math/odds";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { appSettings } from "@/config/appSettings";
import { readLocalJson, writeLocalJson } from "@/lib/client/safeStorage";
import { filterByBooks } from "@/lib/client/bookFilter";

const shortBookNames: Record<string, string> = { draftkings: "DK", fanduel: "FD", betmgm: "MGM", caesars: "CZR", betrivers: "BR", espnbet: "ESPN", fanatics: "FAN", betway: "BWY", ballybet: "BALLY", betparx: "PARX", rebet: "REBET" };

function shortBook(vendor: string): string {
  return shortBookNames[vendor] ?? vendorLabel(vendor);
}

function linkFor(pick: SlipPick, offer: SlipOffer, settings: ReturnType<typeof useSettings>): ResolvedLink | null {
  const bdlLink = pick.kind === "prop" ? resolvePropLink(offer.vendor, offer.deeplinks, pick.selectionKey as "over" | "under" | "yes", settings, offer.eventDeeplinks) : resolveSelectionLink(offer.deeplinks, pick.selectionKey, settings, offer.eventDeeplinks);
  return bdlLink ?? bookHomeLink(offer.vendor, settings); // BDL bet link, else event page, else the book's NBA page
}

function splitLabel(pick: SlipPick): { title: string; market: string } {
  const propMatch = pick.kind === "prop" ? pick.label.match(/^(.*?) ((?:Over|Under) [\d.]+ .*|\d+\+ .*)$/) : null;
  if (propMatch) return { title: propMatch[1], market: propMatch[2] };
  return { title: pick.label, market: pick.market === "moneyline" ? "Moneyline" : pick.market === "spread" ? "Spread" : "Total" };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this", text); // clipboard blocked: let the user copy by hand
    return false;
  }
}

function SlipItem({ pick, settings }: { pick: SlipPick; settings: ReturnType<typeof useSettings> }) {
  const [copied, setCopied] = useState(false);
  const chosen = selectedOffer(pick, settings.defaultBook);
  const offers = [...pick.offers].sort((first, second) => americanToDecimal(second.americanOdds) - americanToDecimal(first.americanOdds));
  const bestVendor = offers[0]?.vendor;
  const link = chosen ? linkFor(pick, chosen, settings) : null;
  const { title, market } = splitLabel(pick);
  const pickText = copyTextFor(pick, chosen);
  return (
    <section className="card slip-item" style={{ marginTop: 0 }}>
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="strong" style={{ fontSize: 17 }}>
            {title}
          </div>
          <div className="small muted">
            {market} · {pick.detail}
            {pick.modelProbability !== null ? ` · model ${formatPercent(pick.modelProbability, 0)}` : ""}
          </div>
        </div>
        <button className="icon-button" onClick={() => removePick(pick.pickId)} aria-label="Remove pick">
          ✕
        </button>
      </div>
      <div className="book-chips">
        {offers.map((offer) => {
          const isChosen = offer.vendor === chosen?.vendor;
          return (
            <button key={offer.vendor} className={`book-chip${isChosen ? " chosen" : ""}`} onClick={() => choosePickVendor(pick.pickId, offer.vendor)} aria-pressed={isChosen}>
              <span className="book-chip-name">
                {shortBook(offer.vendor)}
                {offer.vendor === bestVendor && offers.length > 1 ? " ★" : ""}
              </span>
              <span className="book-chip-odds">{formatAmerican(offer.americanOdds)}</span>
              {pick.kind === "prop" && offer.lineValue !== null ? <span className="book-chip-line">{offer.lineValue}</span> : null}
            </button>
          );
        })}
      </div>
      {chosen ? (
        link ? (
          <a
            className="button primary bet-button"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              if (link.kind !== "selection") copyText(pickText).then(setCopied); // no bet-slip link: copy the pick so it can be pasted into the book's search
            }}
          >
            Bet at {vendorLabel(chosen.vendor)} {formatAmerican(chosen.americanOdds)} ↗
          </a>
        ) : (
          <button className="button bet-button" onClick={() => copyText(pickText).then(setCopied)}>
            Copy pick for {vendorLabel(chosen.vendor)}
          </button>
        )
      ) : null}
      <div className="faint small" style={{ marginTop: 6 }}>
        {copied ? "Pick copied. Paste it into the book's search." : link?.kind === "selection" ? "Opens the bet in the book's slip." : link?.kind === "event" ? "Opens the game in the book; the pick is copied for you." : link?.kind === "book" ? "Opens the book's NBA page; the pick is copied for you." : ""}
        {pick.modelProbability !== null && chosen ? ` EV at this price ${formatSigned(expectedValuePercent(pick.modelProbability, chosen.americanOdds), 1)}%.` : ""}
      </div>
    </section>
  );
}

export default function SlipPage() {
  const savedPicks = useSlip();
  const settings = useSettings();
  const picks = savedPicks.map((pick) => {
    const myBookOffers = filterByBooks(pick.offers, settings.enabledBooks);
    return myBookOffers.length > 0 ? { ...pick, offers: myBookOffers } : pick; // keep every book if none of yours has this pick
  });
  const [stake, setStake] = useState<number>(10);
  const [bankroll, setBankroll] = useState<number>(1000);
  const [parlayCopied, setParlayCopied] = useState(false);
  useEffect(() => {
    setStake(readLocalJson("pulse-nba-stake", 10)); // read after mount so server and browser HTML match
    setBankroll(readLocalJson("pulse-nba-bankroll", 1000));
  }, []);

  const vendors = [...new Set(picks.flatMap((pick) => pick.offers.map((offer) => offer.vendor)))];
  const parlayBooks = vendors
    .map((vendor) => {
      const legs = picks.map((pick) => pick.offers.find((offer) => offer.vendor === vendor) ?? null);
      return legs.every(Boolean) ? { vendor, americanOdds: parlayAmericanOdds(legs.map((offer) => offer!.americanOdds)), decimalOdds: parlayDecimalOdds(legs.map((offer) => offer!.americanOdds)) } : null;
    })
    .filter((entry): entry is { vendor: string; americanOdds: number; decimalOdds: number } => entry !== null)
    .sort((first, second) => second.decimalOdds - first.decimalOdds);
  const [parlayVendor, setParlayVendor] = useState<string | null>(null);
  const activeParlay = parlayBooks.find((entry) => entry.vendor === parlayVendor) ?? parlayBooks.find((entry) => entry.vendor === settings.defaultBook) ?? parlayBooks[0] ?? null;
  const sameGameLegs = picks.length !== new Set(picks.map((pick) => pick.gameId)).size;
  const allModeled = picks.length > 1 && picks.every((pick) => pick.modelProbability !== null);
  const modelParlayChance = allModeled ? parlayProbability(picks.map((pick) => pick.modelProbability!)) : null;
  const parlayText = picks.map((pick) => copyTextFor(pick, selectedOffer(pick, settings.defaultBook))).join("\n");
  const parlayLink = activeParlay ? bookHomeLink(activeParlay.vendor, settings) : null;

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Bet slip</h1>
          <p>Pick a book on each leg, then tap Bet. Prices are from when you added the pick.</p>
        </div>
        {picks.length > 0 ? (
          <button className="button ghost" onClick={clearSlip}>
            Clear
          </button>
        ) : null}
      </div>
      {picks.length === 0 ? (
        <div className="card empty-state">
          Your slip is empty. Tap any price on the <Link href="/" className="expand-hint">slate</Link>, a player page or <Link href="/live" className="expand-hint">Live</Link>.
        </div>
      ) : null}
      <div className="stack" style={{ gap: 10 }}>
        {picks.map((pick) => (
          <SlipItem key={pick.pickId} pick={pick} settings={settings} />
        ))}
      </div>

      {picks.length > 1 ? (
        <section className="card" style={{ marginTop: 12 }}>
          <div className="row-between">
            <h2 style={{ margin: 0, fontSize: 16 }}>Parlay · {picks.length} legs</h2>
            {activeParlay ? (
              <span className="strong tabular" style={{ fontSize: 20 }}>
                {formatAmerican(activeParlay.americanOdds)}
              </span>
            ) : null}
          </div>
          {parlayBooks.length > 0 ? (
            <>
              <div className="book-chips">
                {parlayBooks.map((entry) => (
                  <button key={entry.vendor} className={`book-chip${entry.vendor === activeParlay?.vendor ? " chosen" : ""}`} onClick={() => setParlayVendor(entry.vendor)}>
                    <span className="book-chip-name">{shortBook(entry.vendor)}</span>
                    <span className="book-chip-odds">{formatAmerican(entry.americanOdds)}</span>
                  </button>
                ))}
              </div>
              <div className="small muted" style={{ margin: "6px 0 10px" }}>
                ${stake} wins ${formatNumber(stake * (activeParlay ? activeParlay.decimalOdds - 1 : 0), 2)}
                {modelParlayChance !== null ? ` · model ${formatPercent(modelParlayChance, 1)}` : ""}
                {sameGameLegs ? " · same-game legs: books price these differently" : ""}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className={`button${parlayCopied ? " added" : ""}`}
                  onClick={async () => {
                    setParlayCopied(await copyText(parlayText));
                    window.setTimeout(() => setParlayCopied(false), 1800);
                  }}
                >
                  {parlayCopied ? "Copied" : "Copy all legs"}
                </button>
                {parlayLink && activeParlay ? (
                  <a className="button primary" href={parlayLink.href} target="_blank" rel="noopener noreferrer" onClick={() => copyText(parlayText)}>
                    Open {vendorLabel(activeParlay.vendor)} ↗
                  </a>
                ) : null}
              </div>
            </>
          ) : (
            <p className="small muted">No single book has every leg. Remove a leg or show more books in Settings.</p>
          )}
          <details style={{ marginTop: 10 }}>
            <summary className="expand-hint">Stake and sizing</summary>
            <div className="row wrap" style={{ marginTop: 8, gap: 10 }}>
              <label className="small muted">
                Stake $
                <input className="input" style={{ width: 90, display: "inline-block", padding: "6px 8px", marginLeft: 6 }} type="number" min={1} value={stake} onChange={(changeEvent) => { const nextStake = Math.max(0, Number(changeEvent.target.value)); setStake(nextStake); writeLocalJson("pulse-nba-stake", nextStake); }} />
              </label>
              <label className="small muted">
                Bankroll $
                <input className="input" style={{ width: 100, display: "inline-block", padding: "6px 8px", marginLeft: 6 }} type="number" min={0} value={bankroll} onChange={(changeEvent) => { const nextBankroll = Math.max(0, Number(changeEvent.target.value)); setBankroll(nextBankroll); writeLocalJson("pulse-nba-bankroll", nextBankroll); }} />
              </label>
            </div>
            <ul className="small muted" style={{ paddingLeft: 18 }}>
              {picks.map((pick) => {
                const chosen = selectedOffer(pick, settings.defaultBook);
                const kellyStake = pick.modelProbability !== null && chosen ? kellyFraction(pick.modelProbability, chosen.americanOdds, appSettings.kellyFraction) * bankroll : null;
                return (
                  <li key={pick.pickId}>
                    {pick.label}: {kellyStake === null ? "no model" : kellyStake > 0 ? `quarter Kelly $${formatNumber(kellyStake, 2)}` : "no edge"}
                  </li>
                );
              })}
            </ul>
          </details>
        </section>
      ) : null}
    </main>
  );
}
