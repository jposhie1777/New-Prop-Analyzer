"use client";

import { addPick, removePick, type SlipPick } from "@/lib/client/betSlip";
import { useSlip } from "@/lib/client/hooks";
import { formatAmerican } from "@/lib/math/odds";
import { vendorLabel } from "@/lib/odds/deeplinks";

export function PriceButton({ pick, sideLabel, odds, vendor, note, highlight = false }: { pick: Omit<SlipPick, "addedAt"> | null; sideLabel: string; odds: number | null; vendor: string | null; note?: string | null; highlight?: boolean }) {
  const slip = useSlip();
  if (!pick || odds === null) {
    return (
      <span className="price-button disabled">
        <span className="price-side">{sideLabel}</span>
        <span className="price-odds">-</span>
      </span>
    );
  }
  const inSlip = slip.some((existing) => existing.pickId === pick.pickId);
  return (
    <button
      className={`price-button${inSlip ? " selected" : ""}${highlight ? " value" : ""}`}
      onClick={(clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        if (inSlip) removePick(pick.pickId);
        else addPick(pick); // one tap adds this exact line and side to the slip
      }}
      title={inSlip ? "Tap to remove from slip" : `Add to slip${vendor ? ` (best: ${vendorLabel(vendor)})` : ""}`}
      aria-pressed={inSlip}
    >
      <span className="price-side">
        {inSlip ? "✓ " : ""}
        {sideLabel}
      </span>
      <span className="price-odds">{formatAmerican(odds)}</span>
      {note ? <span className="price-note">{note}</span> : null}
    </button>
  );
}
