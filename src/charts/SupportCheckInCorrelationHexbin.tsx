import { hexbin as hexbinGenerator } from 'd3-hexbin';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

export type CorrelationBinPoint = {
  checkIn: number;
  support: number;
};

const MARGIN = { top: 14, bottom: 48, left: 54, right: 52 };
/** Reserve space for vertical density legend inside right margin. */
const LEGEND_GAP = 10;
const LEGEND_BAR_WIDTH = 14;

function padAxisMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  return max * 1.08;
}

/** Monochrome blue: low density (t≈0) light, high density (t≈1) dark. */
function densityBlue(t: number): string {
  const lo: [number, number, number] = [219, 234, 254]; // blue-100
  const hi: [number, number, number] = [30, 58, 138]; // blue-900
  const x = Math.min(1, Math.max(0, t));
  const r = Math.round(lo[0] + (hi[0] - lo[0]) * x);
  const g = Math.round(lo[1] + (hi[1] - lo[1]) * x);
  const b = Math.round(lo[2] + (hi[2] - lo[2]) * x);
  return `rgb(${r},${g},${b})`;
}

type HexBin = Array<unknown> & { x: number; y: number };

export function SupportCheckInCorrelationHexbin(props: {
  points: readonly CorrelationBinPoint[];
}) {
  const { points } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 300 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(200, Math.floor(r.width));
      setSize({ w, h: 300 });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(200, Math.floor(r.width)), h: 300 });
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const innerW =
      size.w - MARGIN.left - MARGIN.right - LEGEND_GAP - LEGEND_BAR_WIDTH;
    const innerH = size.h - MARGIN.top - MARGIN.bottom;
    const has = points.length > 0;
    const maxX = has ? Math.max(...points.map((p) => p.checkIn), 1) : 1;
    const maxY = has ? Math.max(...points.map((p) => p.support), 1) : 1;
    const xDom = padAxisMax(maxX);
    const yDom = padAxisMax(maxY);
    const radius = Math.max(
      6,
      Math.min(18, Math.min(innerW, innerH) / 22)
    );

    const screenPts: [number, number][] = points.map((p) => {
      const px = MARGIN.left + (p.checkIn / xDom) * innerW;
      const py =
        MARGIN.top + innerH - (p.support / yDom) * innerH;
      return [px, py];
    });

    const hx = hexbinGenerator<[number, number]>()
      .radius(radius)
      .extent([
        [MARGIN.left, MARGIN.top],
        [MARGIN.left + innerW, MARGIN.top + innerH],
      ]);
    const bins = hx(screenPts) as HexBin[];
    const maxCount = bins.reduce((m, b) => Math.max(m, b.length), 0) || 1;

    const hexPath = hx.hexagon(radius);

    const xticks = 5;
    const yticks = 5;
    const xTickVals = Array.from({ length: xticks + 1 }, (_, i) =>
      (i / xticks) * xDom
    );
    const yTickVals = Array.from({ length: yticks + 1 }, (_, i) =>
      (i / yticks) * yDom
    );

    const legendX = MARGIN.left + innerW + LEGEND_GAP;
    const legendTop = MARGIN.top;
    const legendH = innerH;

    return {
      bins,
      maxCount,
      hexPath,
      innerW,
      innerH,
      xDom,
      yDom,
      xTickVals,
      yTickVals,
      legendX,
      legendTop,
      legendH,
      radius,
    };
  }, [points, size.w, size.h]);

  return (
    <div ref={wrapRef} className="clinical-correlation-hexbin-wrap">
      <svg
        className="clinical-correlation-hexbin-svg"
        width={size.w}
        height={size.h}
        role="img"
        aria-label="Hexagonal density plot of check-in calls versus support line calls per patient"
      >
        <defs>
          <linearGradient
            id="clinical-hexbin-legend-gradient"
            x1="0"
            x2="0"
            y1="1"
            y2="0"
          >
            <stop offset="0%" stopColor={densityBlue(0)} />
            <stop offset="100%" stopColor={densityBlue(1)} />
          </linearGradient>
          <clipPath id="clinical-hexbin-plot-clip">
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={layout.innerW}
              height={layout.innerH}
            />
          </clipPath>
        </defs>

        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={layout.innerW}
          height={layout.innerH}
          fill="#fafafa"
          stroke="#e5e7eb"
          strokeWidth={1}
        />

        <g clipPath="url(#clinical-hexbin-plot-clip)">
          {layout.bins.map((bin, i) => {
            const t = bin.length / layout.maxCount;
            return (
              <path
                key={i}
                d={layout.hexPath}
                transform={`translate(${bin.x},${bin.y})`}
                fill={densityBlue(t)}
                fillOpacity={bin.length > 0 ? 0.92 : 0}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={0.35}
              >
                <title>
                  {bin.length} enrolment{bin.length === 1 ? '' : 's'} in this
                  bin
                </title>
              </path>
            );
          })}
        </g>

        {/* Y axis */}
        <text
          x={14}
          y={MARGIN.top + layout.innerH / 2}
          transform={`rotate(-90 14 ${MARGIN.top + layout.innerH / 2})`}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize={11}
        >
          Patient 24/7 support calls
        </text>
        {layout.yTickVals.map((v, i) => {
          const py =
            MARGIN.top + layout.innerH - (v / layout.yDom) * layout.innerH;
          return (
            <g key={`yt-${i}`}>
              <line
                x1={MARGIN.left - 4}
                y1={py}
                x2={MARGIN.left}
                y2={py}
                stroke="#cbd5e1"
              />
              <text
                x={MARGIN.left - 8}
                y={py}
                dy="0.35em"
                textAnchor="end"
                fontSize={10}
                fill="var(--text)"
              >
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* X axis */}
        {layout.xTickVals.map((v, i) => {
          const px = MARGIN.left + (v / layout.xDom) * layout.innerW;
          return (
            <g key={`xt-${i}`}>
              <line
                x1={px}
                y1={MARGIN.top + layout.innerH}
                x2={px}
                y2={MARGIN.top + layout.innerH + 4}
                stroke="#cbd5e1"
              />
              <text
                x={px}
                y={MARGIN.top + layout.innerH + 16}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text)"
              >
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}
        <text
          x={MARGIN.left + layout.innerW / 2}
          y={size.h - 10}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize={11}
        >
          Check-in calls (staff → patient)
        </text>

        {/* Density legend */}
        <rect
          x={layout.legendX}
          y={layout.legendTop}
          width={LEGEND_BAR_WIDTH}
          height={layout.legendH}
          fill="url(#clinical-hexbin-legend-gradient)"
          stroke="#e5e7eb"
          strokeWidth={1}
          rx={2}
        />
        <text
          x={layout.legendX + LEGEND_BAR_WIDTH / 2}
          y={layout.legendTop - 6}
          textAnchor="middle"
          fontSize={10}
          fill="var(--muted)"
        >
          Count
        </text>
        <text
          x={layout.legendX + LEGEND_BAR_WIDTH + 6}
          y={layout.legendTop + layout.legendH}
          fontSize={9}
          fill="var(--muted)"
        >
          0
        </text>
        <text
          x={layout.legendX + LEGEND_BAR_WIDTH + 6}
          y={layout.legendTop + 10}
          fontSize={9}
          fill="var(--muted)"
        >
          {layout.maxCount.toLocaleString()}
        </text>
      </svg>
    </div>
  );
}
