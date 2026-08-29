"use client";

import { useId, useMemo, useState } from "react";

/**
 * Small inline SVG line chart for accrued history.
 *
 * Extends the visual idiom already established by `Sparkline` rather than
 * introducing a charting dependency or a second design language: same tokens,
 * same gradient-under-line treatment, scaled up with axes and hover readout.
 *
 * Accessibility: the series is also exposed as a `<table>` for screen readers
 * (a bare SVG polyline announces nothing), values are labelled on hover AND
 * shown as text, and nothing depends on colour alone to be understood.
 */

export interface ChartPoint {
  date: string;
  value: number | null;
}

export function TimeSeriesChart({
  points,
  label,
  color = "var(--color-brand-soft)",
  format = (v: number) => v.toLocaleString(),
  /** Rankings read better inverted — position 1 belongs at the top. */
  invert = false,
  height = 160,
}: {
  points: ChartPoint[];
  label: string;
  color?: string;
  format?: (value: number) => string;
  invert?: boolean;
  height?: number;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const usable = useMemo(
    () => points.filter((p): p is { date: string; value: number } => p.value !== null),
    [points],
  );

  const geometry = useMemo(() => {
    if (usable.length < 2) return null;
    const values = usable.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    // Pad a flat series so it renders as a centred line, not a divide-by-zero.
    const pad = rawMax === rawMin ? Math.max(rawMax * 0.1, 1) : (rawMax - rawMin) * 0.12;
    const min = rawMin - pad;
    const max = rawMax + pad;

    const w = 100;
    const coords = usable.map((p, i) => {
      const x = (i / (usable.length - 1)) * w;
      const ratio = (p.value - min) / (max - min);
      const y = invert ? ratio * 100 : (1 - ratio) * 100;
      return { x, y, ...p };
    });

    return {
      coords,
      line: coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" "),
      area: `${coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ")} L100,100 L0,100 Z`,
      min: rawMin,
      max: rawMax,
    };
  }, [usable, invert]);

  if (!geometry) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-line bg-canvas/40 text-center text-[11px] text-subtle"
        style={{ height }}
      >
        {usable.length === 1
          ? "One reading so far — a trend needs at least two."
          : "No readings yet."}
      </div>
    );
  }

  const active = hover === null ? null : geometry.coords[hover];

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-ink">{label}</span>
        <span className="nums text-subtle">
          {active
            ? `${active.date} · ${format(active.value)}`
            : `${format(geometry.min)} – ${format(geometry.max)}`}
        </span>
      </div>

      <div className="relative" style={{ height }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 50, 100].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              stroke="var(--color-line)"
              strokeWidth="0.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={geometry.area} fill={`url(#${gradientId})`} />
          <path
            d={geometry.line}
            fill="none"
            stroke={color}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {active && (
            <circle cx={active.x} cy={active.y} r="2" fill={color} vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* Hover targets. Separate from the SVG so each has a real hit area
            regardless of how few points there are. */}
        <div className="absolute inset-0 flex">
          {geometry.coords.map((c, i) => (
            <button
              key={c.date}
              type="button"
              tabIndex={-1}
              aria-label={`${c.date}: ${format(c.value)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              className="h-full flex-1 cursor-default"
            />
          ))}
        </div>
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-subtle">
        <span>{geometry.coords[0].date}</span>
        <span>{geometry.coords.at(-1)!.date}</span>
      </div>

      {/* Screen-reader equivalent — an SVG path announces nothing useful. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {usable.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
