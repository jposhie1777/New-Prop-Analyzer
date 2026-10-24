"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSettings, useSlip } from "@/lib/client/hooks";
import { bestOffer, clearSlip, copyTextFor, removePick, type SlipOffer, type SlipPick } from "@/lib/client/betSlip";
import { resolvePropLink, resolveSelectionLink, copyOnlyPropVendors, vendorLabel, type ResolvedLink } from "@/lib/odds/deeplinks";
import { americanToDecimal, expectedValuePercent, formatAmerican, kellyFraction, parlayAmericanOdds, parlayDecimalOdds, parlayProbability, payoutFor } from "@/lib/math/odds";
import { formatNumber, formatPercent, formatSigned } from "@/lib/client/format";
import { appSettings } from "@/config/appSettings";
import { readLocalJson, writeLocalJson } from "@/lib/client/safeStorage";

function offerLink(pick: SlipPick, offer: SlipOffer, settings: ReturnType<typeof useSettings>): ResolvedLink | null {
  if (pick.kind === "prop") return resolvePropLink(offer.vendor, offer.deeplinks, pick.selectionKey as "over" | "under" | "yes", settings, offer.eventDeeplinks);
  return resolveSelectionLink(offer.deeplinks, pick.selectionKey, settings, offer.eventDeeplinks);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`button small ghost${copied ? " added" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this pick", text); // clipboard blocked: let the user copy by hand
        }
      }}
    >
      {copied ? "Copied" : "Copy pick"}
    </button>
  );
}

export default function SlipPage() {
  const picks = useSlip();
  const settings = useSettings();
  const [stake, setStake] = useState<number>(10);
  const [bankroll, setBankroll] = useState<number>(1000);
  useEffect(() => {
    setStake(readLocalJson("pulse-nba-stake", 10)); // read after mount so server and browser HTML match
    setBankroll(readLocalJson("pulse-nba-bankroll", 1000));
  }, []);
  const vendors = [...new Set(picks.flatMap((pick) => pick.offers.map((offer) => offer.vendor)))].sort();
  const sameGameLegs = picks.length !== new Set(picks.map((pick) => pick.gameId)).size;

  const bookParlays = vendors.map((vendor) => {
    const legOffers = picks.map((pick) => pick.offers.find((offer) => offer.vendor === vendor) ?? null);
    const complete = picks.length > 1 && legOffers.every((offer) => offer !== null);
    return { vendor, complete, americanOdds: complete ? parlayAmericanOdds(legOffers.map((offer) => offer!.americanOdds)) : null, decimalOdds: complete ? parlayDecimalOdds(legOffers.map((offer) => offer!.americanOdds)) : null };
  });
  const bestLegs = picks.map((pick) => bestOffer(pick));
  const bestDecimal = picks.length > 1 && bestLegs.every(Boolean) ? parlayDecimalOdds(bestLegs.map((offer) => offer!.americanOdds)) : null;
  const allModeled = picks.length > 1 && picks.every((pick) => pick.modelProbability !== null);
  const modelParlayChance = allModeled ? parlayProbability(picks.map((pick) => pick.modelProbability!)) : null;

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>Bet slip</h1>
          <p>Saved on this device. Prices are the latest seen when the pick was added; check the book before betting.</p>
        </div>
        {picks.length > 0 ? (
          <button className="button ghost" onClick={clearSlip}>
            Clear slip
          </button>
        ) : null}
      </div>
      {picks.length === 0 ? (
        <div className="card empty-state">
          Your slip is empty. Add picks from the <Link href="/" className="expand-hint">slate</Link>, a player page, or halftime mode on <Link href="/live" className="expand-hint">Live</Link>.
        </div>
      ) : null}
      <div className="stack" style={{ gap: 12 }}>
        {picks.map((pick) => {
          const best = bestOffer(pick);
          const kellyStake = pick.modelProbability !== null && best ? kellyFraction(pick.modelProbability, best.americanOdds, appSettings.kellyFraction) * bankroll : null;
          return (
            <section key={pick.pickId} className="card" style={{ marginTop: 0 }}>
              <div className="card-header wrap">
                <div>
                  <h3>{pick.label}</h3>
                  <div className="faint small">
                    {pick.detail} · from {pick.source}
                    {pick.modelProbability !== null ? ` · model ${formatPercent(pick.modelProbability, 1)}` : ""}
                  </div>
                </div>
                <div className="row">
                  <CopyButton text={copyTextFor(pick, best)} />
                  <button className="button small ghost" onClick={() => removePick(pick.pickId)}>
                    Remove
                  </button>
                </div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Book</th>
                      <th>Line</th>
                      <th>Odds</th>
                      {pick.modelProbability !== null ? <th>EV</th> : null}
                      <th>Bet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pick.offers]
                      .sort((first, second) => americanToDecimal(second.americanOdds) - americanToDecimal(first.americanOdds))
                      .map((offer) => {
                        const link = offerLink(pick, offer, settings);
                        const copyOnly = pick.kind === "prop" && copyOnlyPropVendors.has(offer.vendor);
                        return (
                          <tr key={offer.vendor}>
                            <td>
                              {vendorLabel(offer.vendor)} {offer === best ? <span className="pill positive">best</span> : null}
                            </td>
                            <td>{offer.lineValue ?? "-"}</td>
                            <td className="strong">{formatAmerican(offer.americanOdds)}</td>
                            {pick.modelProbability !== null ? <td className={expectedValuePercent(pick.modelProbability, offer.americanOdds) >= 0 ? "positive" : "negative"}>{formatSigned(expectedValuePercent(pick.modelProbability, offer.americanOdds))}%</td> : null}
                            <td>
                              <span className="row" style={{ justifyContent: "flex-end" }}>
                                {link ? (
                                  <a className="button small" href={link.href} target="_blank" rel="noopener noreferrer">
                                    {link.kind === "selection" ? "Bet ↗" : "Event ↗"}
                                  </a>
                                ) : (
                                  <span className="faint small">no link</span>
                                )}
                                {copyOnly ? <CopyButton text={copyTextFor(pick, offer)} /> : null}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {kellyStake !== null ? (
                <div className="faint small" style={{ marginTop: 8 }}>
                  Quarter Kelly at best price: {kellyStake > 0 ? `$${formatNumber(kellyStake, 2)} of $${bankroll}` : "no edge, skip"}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {picks.length > 1 ? (
        <section className="card" style={{ marginTop: 12 }}>
          <div className="card-header wrap">
            <h2>Parlay ({picks.length} legs)</h2>
            <div className="row">
              <label className="small muted">
                Stake ${" "}
                <input
                  className="input"
                  style={{ width: 90, display: "inline-block", padding: "6px 8px" }}
                  type="number"
                  min={1}
                  value={stake}
                  onChange={(changeEvent) => {
                    const nextStake = Math.max(0, Number(changeEvent.target.value));
                    setStake(nextStake);
                    writeLocalJson("pulse-nba-stake", nextStake);
                  }}
                />
              </label>
              <label className="small muted">
                Bankroll ${" "}
                <input
                  className="input"
                  style={{ width: 100, display: "inline-block", padding: "6px 8px" }}
                  type="number"
                  min={0}
                  value={bankroll}
                  onChange={(changeEvent) => {
                    const nextBankroll = Math.max(0, Number(changeEvent.target.value));
                    setBankroll(nextBankroll);
                    writeLocalJson("pulse-nba-bankroll", nextBankroll);
                  }}
                />
              </label>
            </div>
          </div>
          {sameGameLegs ? <div className="notice" style={{ marginBottom: 10 }}>Some legs are from the same game. Books price same-game parlays differently (correlation), so these numbers are only a guide.</div> : null}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Parlay odds</th>
                  <th>Decimal</th>
                  <th>Payout on ${stake}</th>
                </tr>
              </thead>
              <tbody>
                {bookParlays.map((bookParlay) => (
                  <tr key={bookParlay.vendor}>
                    <td>{vendorLabel(bookParlay.vendor)}</td>
                    <td className="strong">{bookParlay.complete ? formatAmerican(bookParlay.americanOdds) : <span className="faint">missing legs</span>}</td>
                    <td>{bookParlay.decimalOdds ? formatNumber(bookParlay.decimalOdds, 2) : "-"}</td>
                    <td>{bookParlay.decimalOdds ? `$${formatNumber(stake * bookParlay.decimalOdds, 2)}` : "-"}</td>
                  </tr>
                ))}
                {bestDecimal ? (
                  <tr>
                    <td className="strong">Best price per leg</td>
                    <td className="strong">{formatAmerican(parlayAmericanOdds(bestLegs.map((offer) => offer!.americanOdds)))}</td>
                    <td>{formatNumber(bestDecimal, 2)}</td>
                    <td>${formatNumber(stake * bestDecimal, 2)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {modelParlayChance !== null && bestDecimal ? (
            <p className="small muted" style={{ marginBottom: 0 }}>
              Model parlay chance {formatPercent(modelParlayChance, 1)} (legs assumed independent) · EV at best prices {formatSigned((modelParlayChance * bestDecimal - 1) * 100)}% · quarter Kelly ${formatNumber(kellyFraction(modelParlayChance, parlayAmericanOdds(bestLegs.map((offer) => offer!.americanOdds)), appSettings.kellyFraction) * bankroll, 2)}
            </p>
          ) : (
            <p className="faint small" style={{ marginBottom: 0 }}>
              Win on ${stake} at best prices: ${bestDecimal ? formatNumber(payoutFor(stake, parlayAmericanOdds(bestLegs.map((offer) => offer!.americanOdds))) - stake, 2) : "-"}. Add halftime picks to see model probability and Kelly sizing.
            </p>
          )}
        </section>
      ) : null}
      <p className="faint small" style={{ marginTop: 12 }}>
        Links use BALLDONTLIE deeplinks with your state ({settings.sportsbookState.toUpperCase()}). FanDuel and DraftKings props open the event page; use Copy pick to find the line. No sportsbook pages are scraped.
      </p>
    </main>
  );
}
