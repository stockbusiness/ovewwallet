"use client";

import { useMemo, useState } from "react";

export interface TrendPoint {
  date: string;
  credited: string;
  debited: string;
}

interface TrendChartProps {
  data: TrendPoint[];
}

const WIDTH = 720;
const HEIGHT = 220;
const PAD_LEFT = 56;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
// CSS変数を参照し、ダーク/ライト両テーマに追従させる (globals.css参照)。
const GOLD = "rgb(var(--sengoku-gold))";
const RED = "rgb(var(--sengoku-red))";
const SURFACE = "rgb(var(--sengoku-navy))";
const GRID_LINE = "rgb(var(--sengoku-border))";
const AXIS_TEXT = "rgb(var(--sengoku-faint))";

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** 「発行OVE / 利用OVE 過去30日推移」の折れ線グラフ。実データのみを描画する。 */
export function TrendChart({ data }: TrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { points, maxValue, plotWidth, plotHeight, yTicks } = useMemo(() => {
    const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const max = niceMax(Math.max(1, ...data.map((d) => Math.max(Number(d.credited), Number(d.debited)))));
    const step = data.length > 1 ? plotW / (data.length - 1) : 0;

    const toXY = (value: number, index: number) => ({
      x: PAD_LEFT + step * index,
      y: PAD_TOP + plotH * (1 - value / max),
    });

    const creditedPoints = data.map((d, i) => toXY(Number(d.credited), i));
    const debitedPoints = data.map((d, i) => toXY(Number(d.debited), i));
    const ticks = [0, max * 0.5, max].map((v) => Math.round(v));

    return { points: { creditedPoints, debitedPoints }, maxValue: max, plotWidth: plotW, plotHeight: plotH, yTicks: ticks };
  }, [data]);

  if (data.length === 0) {
    return <p className="py-10 text-center text-xs text-sengoku-faint">表示できるデータがありません</p>;
  }

  const path = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const lastCredited = points.creditedPoints[points.creditedPoints.length - 1];
  const lastDebited = points.debitedPoints[points.debitedPoints.length - 1];
  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
    const idx = step > 0 ? Math.round((relX - PAD_LEFT) / step) : 0;
    setHoverIndex(Math.min(Math.max(idx, 0), data.length - 1));
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-sengoku-muted">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GOLD }} />
          発行OVE
        </span>
        <span className="flex items-center gap-1.5 text-sengoku-muted">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: RED }} />
          利用OVE
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        role="img"
        aria-label="発行OVEと利用OVEの過去30日推移の折れ線グラフ"
      >
        {yTicks.map((tick) => {
          const y = PAD_TOP + plotHeight * (1 - tick / maxValue);
          return (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke={GRID_LINE} strokeWidth={1} />
              <text x={PAD_LEFT - 8} y={y + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                {tick.toLocaleString("ja-JP")}
              </text>
            </g>
          );
        })}

        <path d={path(points.creditedPoints)} fill="none" stroke={GOLD} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <path d={path(points.debitedPoints)} fill="none" stroke={RED} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        <circle cx={lastCredited.x} cy={lastCredited.y} r={4} fill={GOLD} stroke={SURFACE} strokeWidth={2} />
        <circle cx={lastDebited.x} cy={lastDebited.y} r={4} fill={RED} stroke={SURFACE} strokeWidth={2} />
        <text x={lastCredited.x} y={lastCredited.y - 8} textAnchor="end" fontSize={10} fontWeight={700} fill={GOLD}>
          {Number(data[data.length - 1].credited).toLocaleString("ja-JP")}
        </text>
        <text x={lastDebited.x} y={lastDebited.y + 14} textAnchor="end" fontSize={10} fontWeight={700} fill={RED}>
          {Number(data[data.length - 1].debited).toLocaleString("ja-JP")}
        </text>

        {hoverIndex !== null && (
          <line
            x1={PAD_LEFT + (plotWidth / Math.max(1, data.length - 1)) * hoverIndex}
            x2={PAD_LEFT + (plotWidth / Math.max(1, data.length - 1)) * hoverIndex}
            y1={PAD_TOP}
            y2={PAD_TOP + plotHeight}
            stroke={AXIS_TEXT}
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}
      </svg>

      <div className="mt-1 flex justify-between text-[10px] text-sengoku-faint">
        <span>{data[0].date}</span>
        <span>{data[data.length - 1].date}</span>
      </div>

      {hovered && (
        <div className="mt-2 rounded-lg border border-sengoku-border bg-sengoku-bg px-3 py-2 text-xs text-sengoku-muted">
          <span className="font-semibold text-sengoku-text">{hovered.date}</span>
          <span className="ml-3" style={{ color: GOLD }}>
            発行 {Number(hovered.credited).toLocaleString("ja-JP")} OVE
          </span>
          <span className="ml-3" style={{ color: RED }}>
            利用 {Number(hovered.debited).toLocaleString("ja-JP")} OVE
          </span>
        </div>
      )}
    </div>
  );
}
