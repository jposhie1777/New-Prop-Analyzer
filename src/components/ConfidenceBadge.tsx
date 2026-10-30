"use client";

import { confidenceLevels, type ConfidenceRating } from "@/lib/analytics/confidence";

export function ConfidenceBadge({ rating }: { rating: ConfidenceRating | null }) {
  if (!rating) return null;
  return (
    <span className={`confidence-badge ${rating.level}`} title={`Confidence ${rating.score} of 100`}>
      <span className="confidence-bar" aria-hidden>
        <i style={{ width: `${rating.score}%` }} />
      </span>
      {rating.score} · {confidenceLevels[rating.level].label}
    </span>
  );
}
