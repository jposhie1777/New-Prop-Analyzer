"use client";

import { useState } from "react";
import { Segmented } from "@/components/Segmented";
import { copyTextFor, selectedOffer, type SlipPick } from "@/lib/client/betSlip";
import { vendorLabel } from "@/lib/odds/deeplinks";

const gamblyPhoneDisplay = "(305) 857-2288"; // GamblyBot's texting number, from gambly.com
const gamblyPhoneDigits = "+13058572288";

type GamblyMode = "parlay" | "singles";

export function gamblyMessage(picks: SlipPick[], mode: GamblyMode, bookVendor: string | null, defaultBook: string): string {
  const bookText = bookVendor ? ` on ${vendorLabel(bookVendor)}` : "";
  const heading = picks.length > 1 && mode === "parlay" ? `Build a ${picks.length}-leg parlay${bookText}:` : `Build ${picks.length === 1 ? "this bet" : "these as single bets"}${bookText}:`;
  const lines = picks.map((pick, pickIndex) => `${pickIndex + 1}. ${copyTextFor(pick, selectedOffer(pick, defaultBook))}`);
  return [heading, ...lines].join("\n");
}

export function GamblyCard({ picks, parlayVendor, defaultBook, copyText }: { picks: SlipPick[]; parlayVendor: string | null; defaultBook: string; copyText: (text: string) => Promise<boolean> }) {
  const [mode, setMode] = useState<GamblyMode>("parlay");
  const [copied, setCopied] = useState(false);
  const bookVendor = picks.length > 1 && mode === "parlay" ? parlayVendor : defaultBook || null;
  const message = gamblyMessage(picks, mode, bookVendor, defaultBook);
  const smsLink = `sms:${gamblyPhoneDigits}?&body=${encodeURIComponent(message)}`; // the ?& form opens a prefilled text on both iPhone and Android
  const markCopied = async () => {
    setCopied(await copyText(message));
    window.setTimeout(() => setCopied(false), 2500);
  };
  return (
    <section className="card gambly-card">
      <div className="card-header wrap">
        <div>
          <h2>Send to GamblyBot</h2>
          <div className="faint small">GamblyBot texts back a bet slip loaded at your book.</div>
        </div>
        {picks.length > 1 ? (
          <Segmented
            label="Bet type"
            options={[
              { value: "parlay", label: "Parlay" },
              { value: "singles", label: "Singles" },
            ]}
            value={mode}
            onChange={setMode}
          />
        ) : null}
      </div>
      <pre className="gambly-preview">{message}</pre>
      <div className="row wrap" style={{ gap: 8 }}>
        <a className="button primary" href={smsLink} onClick={() => void markCopied()}>
          Text GamblyBot
        </a>
        <button className={`button${copied ? " added" : ""}`} onClick={() => void markCopied()}>
          {copied ? "Copied" : "Copy for Gambly"}
        </button>
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>
        Text GamblyBot opens Messages with the bets filled in, to {gamblyPhoneDisplay}. On a computer, copy and paste into the Gambly app or your text thread instead.
      </p>
    </section>
  );
}
