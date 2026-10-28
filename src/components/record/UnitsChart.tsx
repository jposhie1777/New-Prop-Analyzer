import { formatSigned } from "@/lib/client/format";

const chartWidth = 640;
const chartHeight = 170;
const plotLeft = 40;
const plotRight = 624;
const plotTop = 14;
const plotBottom = 150;

function niceStep(range: number): number {
  const rough = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 0.1)));
  return [1, 2, 5, 10].map((multiple) => multiple * magnitude).find((step) => step >= rough) ?? magnitude * 10;
}

export function UnitsChart({ runningUnits }: { runningUnits: number[] }) {
  if (runningUnits.length < 2) return <p className="faint small" style={{ margin: 0 }}>The chart starts after two graded picks.</p>;
  const points = [0, ...runningUnits];
  const step = niceStep(Math.max(...points) - Math.min(...points) || 1);
  const highest = Math.ceil(Math.max(0, ...points) / step) * step;
  const lowest = Math.floor(Math.min(0, ...points) / step) * step;
  const xAt = (pointIndex: number) => plotLeft + (pointIndex / (points.length - 1)) * (plotRight - plotLeft);
  const yAt = (units: number) => plotTop + ((highest - units) / (highest - lowest || 1)) * (plotBottom - plotTop);
  const ticks: number[] = [];
  for (let tick = lowest; tick <= highest + 1e-9; tick += step) ticks.push(Math.round(tick * 100) / 100);
  const finalUnits = points[points.length - 1];
  const tone = finalUnits >= 0 ? "positive" : "negative";
  const linePoints = points.map((units, pointIndex) => `${xAt(pointIndex).toFixed(1)},${yAt(units).toFixed(1)}`).join(" ");
  const endX = xAt(points.length - 1);
  const endY = yAt(finalUnits);
  return (
    <svg className={`units-chart ${tone}`} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Running units over ${runningUnits.length} graded picks, now ${formatSigned(finalUnits, 2)}`}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className={tick === 0 ? "units-zero" : "units-grid"} x1={plotLeft} x2={plotRight} y1={yAt(tick)} y2={yAt(tick)} />
          <text x={plotLeft - 6} y={yAt(tick) + 4} textAnchor="end">
            {tick > 0 ? "+" : ""}
            {tick}u
          </text>
        </g>
      ))}
      <polygon className="units-area" points={`${xAt(0)},${yAt(0)} ${linePoints} ${endX},${yAt(0)}`} />
      <polyline className="units-line" points={linePoints} />
      <circle className="units-end" cx={endX} cy={endY} r={4.5} />
      <text className="units-end-label" x={endX - 8} y={endY < plotTop + 20 ? endY + 18 : endY - 10} textAnchor="end">
        {formatSigned(finalUnits, 2)}u
      </text>
    </svg>
  );
}
