"use client";

import { addPick, removePick, type SlipPick } from "@/lib/client/betSlip";
import { useSlip } from "@/lib/client/hooks";

export function AddToSlipButton({ pick, label = "+ Slip" }: { pick: Omit<SlipPick, "addedAt"> | null; label?: string }) {
  const slip = useSlip();
  if (!pick) return null;
  const inSlip = slip.some((existing) => existing.pickId === pick.pickId);
  return (
    <button
      className={`button small${inSlip ? " added" : ""}`}
      onClick={(clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        if (inSlip) removePick(pick.pickId);
        else addPick(pick);
      }}
      title={inSlip ? "Remove from bet slip" : "Add to bet slip"}
    >
      {inSlip ? "✓ In slip" : label}
    </button>
  );
}
