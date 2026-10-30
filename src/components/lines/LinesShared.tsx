"use client";

import { Segmented } from "@/components/Segmented";
import { confidenceLevel, confidenceLevels, confidenceTiers, type ConfidenceRating } from "@/lib/analytics/confidence";
import type { LineEdge } from "@/lib/analytics/gameModel";

export const marketTitles: Record<LineEdge["market"], string> = { spread: "Spread", total: "Total", moneyline: "Money" };

export type MarketFilter = "all" | LineEdge["market"];
export type LevelFilter = number; // minimum confidence score, 0 = any
export type SortKey = "confidence" | "ev" | "time";
export type LinesView = "games" | "plays";

export const minimumScoreOptions = [0, ...confidenceTiers.filter((tier) => tier !== "very-low").reverse().map((tier) => confidenceLevels[tier].minimum)]; // Low and up, Medium and up, ...

export function meetsLevel(rating: ConfidenceRating | null, levelFilter: LevelFilter): boolean {
  return levelFilter === 0 || (rating?.score ?? 0) >= levelFilter;
}

export function levelFilterText(levelFilter: LevelFilter): string {
  return levelFilter > 0 ? ` with ${confidenceLevels[confidenceLevel(levelFilter)].label.toLowerCase()}+ confidence` : "";
}

export function bestEdgesByMarket(edges: LineEdge[], marketFilter: MarketFilter): LineEdge[] {
  return (["spread", "total", "moneyline"] as const)
    .filter((market) => marketFilter === "all" || marketFilter === market)
    .map((market) => edges.filter((edge) => edge.market === market).sort((first, second) => second.evPercent - first.evPercent)[0])
    .filter((edge): edge is LineEdge => Boolean(edge)); // the model's side in each market
}

export function ConfidenceBreakdown({ rating }: { rating: ConfidenceRating }) {
  return (
    <div className="confidence-breakdown">
      {rating.parts.map((part) => (
        <div key={part.label} className="confidence-part">
          <span className="strong">{part.label}</span>
          <span className="meter">
            <span style={{ width: `${(part.points / part.maximum) * 100}%` }} />
          </span>
          <span className="tabular small">
            {Math.round(part.points)}/{part.maximum}
          </span>
          <span className="faint small confidence-note">{part.note}</span>
        </div>
      ))}
    </div>
  );
}

export interface LinesFilters {
  view: LinesView;
  marketFilter: MarketFilter;
  levelFilter: LevelFilter;
  sortKey: SortKey;
}

export function LinesToolbar({ filters, onChange, children }: { filters: LinesFilters; onChange: (next: LinesFilters) => void; children?: React.ReactNode }) {
  return (
    <div className="lines-toolbar">
      <Segmented
        label="View"
        options={[
          { value: "games", label: "Games" },
          { value: "plays", label: "Plays" },
        ]}
        value={filters.view}
        onChange={(view) => onChange({ ...filters, view })}
      />
      <Segmented
        label="Market"
        options={[
          { value: "all", label: "All" },
          { value: "spread", label: "Spread" },
          { value: "total", label: "Total" },
          { value: "moneyline", label: "Money" },
        ]}
        value={filters.marketFilter}
        onChange={(marketFilter) => onChange({ ...filters, marketFilter })}
      />
      <label className="small muted lines-sort">
        Confidence
        <select className="input" value={filters.levelFilter} onChange={(changeEvent) => onChange({ ...filters, levelFilter: Number(changeEvent.target.value) })}>
          {minimumScoreOptions.map((minimumScore) => (
            <option key={minimumScore} value={minimumScore}>
              {minimumScore === 0 ? "Any" : `${confidenceLevels[confidenceLevel(minimumScore)].label}${minimumScore < confidenceLevels["very-high"].minimum ? "+" : ""} (${minimumScore}+)`}
            </option>
          ))}
        </select>
      </label>
      <label className="small muted lines-sort">
        Sort
        <select className="input" value={filters.sortKey} onChange={(changeEvent) => onChange({ ...filters, sortKey: changeEvent.target.value as SortKey })}>
          <option value="confidence">Confidence</option>
          <option value="ev">EV</option>
          <option value="time">Tip-off</option>
        </select>
      </label>
      {children}
    </div>
  );
}
