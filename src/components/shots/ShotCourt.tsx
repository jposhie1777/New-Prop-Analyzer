"use client";

import { shotZoneKeys, shotZoneLabels, type ShotZoneKey } from "@/lib/data/shotZones";

export interface ZoneDisplay {
  label: string;
  tone: "good" | "neutral" | "bad" | "empty" | "volume";
  intensity?: number; // 0-1, for volume shading
}

const toneFills: Record<ZoneDisplay["tone"], string> = {
  good: "var(--court-good)", // theme colors live in globals.css
  neutral: "var(--court-neutral)",
  bad: "var(--court-bad)",
  empty: "var(--court-empty)",
  volume: "var(--accent)",
};

const basketX = 250;
const basketY = 52.5;
const insideArcPath = "M30 0 L30 142 A237.5 237.5 0 0 0 470 142 L470 0 Z"; // everything inside the 3-point line, in tenths of a foot
const restrictedPath = "M210 0 L210 52.5 A40 40 0 0 0 290 52.5 L290 0 Z";

const labelPositions: Record<ShotZoneKey, [number, number]> = {
  rim: [250, 36],
  paint: [250, 140],
  mid_left: [100, 120],
  mid_center: [250, 232],
  mid_right: [400, 120],
  corner3_left: [36, 70],
  corner3_right: [464, 70],
  above3_left: [72, 300],
  above3_center: [250, 318],
  above3_right: [428, 300],
};

function zoneFill(display: ZoneDisplay | undefined): { fill: string; opacity: number } {
  if (!display) return { fill: toneFills.empty, opacity: 1 };
  if (display.tone === "volume") return { fill: toneFills.volume, opacity: 0.12 + 0.7 * Math.min(1, Math.max(0, display.intensity ?? 0)) };
  return { fill: toneFills[display.tone], opacity: 1 };
}

export function ShotCourt({ zones, selectedZone, onSelect, title }: { zones: Partial<Record<ShotZoneKey, ZoneDisplay>>; selectedZone: ShotZoneKey | null; onSelect: (zone: ShotZoneKey) => void; title: string }) {
  const clipId = `inside-arc-${title.replace(/[^a-z0-9]/gi, "")}`;
  const zoneProps = (zone: ShotZoneKey) => {
    const { fill, opacity } = zoneFill(zones[zone]);
    return {
      fill,
      fillOpacity: opacity,
      stroke: selectedZone === zone ? "var(--text-primary)" : "var(--court-gap)",
      strokeWidth: selectedZone === zone ? 4 : 2,
      onClick: () => onSelect(zone),
      style: { cursor: "pointer" },
      role: "button",
      tabIndex: 0,
      "aria-label": `${shotZoneLabels[zone]}: ${zones[zone]?.label ?? "no shots"}`,
      onKeyDown: (keyEvent: React.KeyboardEvent) => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") onSelect(zone);
      },
    };
  };
  return (
    <svg className="shot-court" viewBox="0 0 500 345" role="group" aria-label={title}>
      <defs>
        <clipPath id={clipId}>
          <path d={insideArcPath} />
        </clipPath>
      </defs>
      <rect x="0" y="0" width="500" height="345" fill="var(--court-empty)" />
      <rect x="0" y="0" width="170" height="345" {...zoneProps("above3_left")} />
      <rect x="170" y="0" width="160" height="345" {...zoneProps("above3_center")} />
      <rect x="330" y="0" width="170" height="345" {...zoneProps("above3_right")} />
      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="0" width="170" height="345" {...zoneProps("mid_left")} />
        <rect x="170" y="0" width="160" height="345" {...zoneProps("mid_center")} />
        <rect x="330" y="0" width="170" height="345" {...zoneProps("mid_right")} />
      </g>
      <rect x="0" y="0" width="30" height="142" {...zoneProps("corner3_left")} />
      <rect x="470" y="0" width="30" height="142" {...zoneProps("corner3_right")} />
      <rect x="170" y="0" width="160" height="190" {...zoneProps("paint")} />
      <path d={restrictedPath} {...zoneProps("rim")} />
      <g fill="none" stroke="var(--court-line)" strokeWidth="2.5" pointerEvents="none">
        <path d="M30 0 L30 142 A237.5 237.5 0 0 0 470 142 L470 0" />
        <rect x="170" y="0" width="160" height="190" />
        <path d="M190 190 A60 60 0 0 0 310 190" />
        <path d={restrictedPath} />
        <line x1="220" y1="40" x2="280" y2="40" />
        <circle cx={basketX} cy={basketY} r="7.5" />
      </g>
      {shotZoneKeys.map((zone) => {
        const display = zones[zone];
        if (!display) return null;
        const [labelX, labelY] = labelPositions[zone];
        const pillWidth = Math.max(44, display.label.length * 11 + 16);
        return (
          <g key={zone} pointerEvents="none">
            <rect x={labelX - pillWidth / 2} y={labelY - 15} width={pillWidth} height="30" rx="9" fill="var(--surface-raised)" fillOpacity={0.92} stroke={selectedZone === zone ? "var(--text-primary)" : "var(--border-strong)"} />
            <text x={labelX} y={labelY + 6} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-primary)" fontFamily="var(--font-sans)">
              {display.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
