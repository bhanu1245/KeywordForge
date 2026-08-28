"use client";

import { useMemo, useState } from "react";
import type { KeywordRow } from "@/lib/types";
import { MONTHS } from "@/lib/seo/trends";
import { Icon } from "./Icon";
import { EmptyState, Pill, Sparkline, formatCompact, formatNumber } from "./ui";

/**
 * Trend Detection and Seasonality (PRD §7 modules 27 and 28).
 *
 * Reads the 12-month series already stored on every keyword, so this tab costs
 * nothing to open — the data arrived with the original volume lookup.
 *
 * The planning value is timing: a seasonal keyword needs its content live
 * ~2 months before the peak, which is the one thing a flat keyword list will
 * never tell you.
 */

type View = "rising" | "falling" | "seasonal";

function ChangeBadge({ direction, percent }: { direction: string; percent: number }) {
  if (direction === "stable") {
    return <span className="nums text-xs text-subtle">flat</span>;
  }
  const rising = direction === "rising";
  return (
    <span className={`nums inline-flex items-center gap-0.5 text-xs font-medium ${rising ? "text-easy" : "text-extreme"}`}>
      <Icon name={rising ? "arrowUp" : "arrowDown"} size={11} />
      {Math.abs(percent).toFixed(0)}%
    </span>
  );
}

export function TrendsPanel({ keywords }: { keywords: KeywordRow[] }) {
  const [view, setView] = useState<View>("rising");

  const buckets = useMemo(() => {
    const rising = keywords
      .filter((k) => k.trendDirection === "rising")
      .sort((a, b) => b.trendChangePercent - a.trendChangePercent);
    const falling = keywords
      .filter((k) => k.trendDirection === "falling")
      .sort((a, b) => a.trendChangePercent - b.trendChangePercent);
    const seasonal = keywords
      .filter((k) => k.isSeasonal)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    return { rising, falling, seasonal };
  }, [keywords]);

  /** Which months the project's seasonal demand concentrates in. */
  const peakCalendar = useMemo(() => {
    const counts = new Array(12).fill(0) as number[];
    const volume = new Array(12).fill(0) as number[];
    for (const k of buckets.seasonal) {
      for (const label of k.peakMonths) {
        const i = MONTHS.indexOf(label as (typeof MONTHS)[number]);
        if (i >= 0) {
          counts[i]++;
          volume[i] += k.volume ?? 0;
        }
      }
    }
    const max = Math.max(...counts, 1);
    return counts.map((count, i) => ({
      month: MONTHS[i],
      count,
      volume: volume[i],
      share: Math.round((count / max) * 100),
    }));
  }, [buckets.seasonal]);

  const rows = buckets[view];

  if (keywords.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No keywords to analyse"
        hint="Discover some keywords first — trend and seasonality are read from the 12-month volume history that arrives with them."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ["Rising", buckets.rising.length, "text-easy"],
          ["Falling", buckets.falling.length, "text-extreme"],
          ["Seasonal", buckets.seasonal.length, "text-brand-soft"],
          ["Evergreen", keywords.length - buckets.seasonal.length, "text-ink"],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-subtle">{String(label)}</div>
            <div className={`nums mt-0.5 text-lg font-semibold ${tone}`}>{formatNumber(Number(value))}</div>
          </div>
        ))}
      </div>

      {buckets.seasonal.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="text-xs font-semibold text-ink">Demand calendar</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            When this project&apos;s seasonal keywords peak. Publish roughly two months ahead of a spike.
          </p>
          <div className="mt-3 flex items-end gap-1.5">
            {peakCalendar.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className="w-full rounded-t bg-brand-soft/70 transition-all"
                  style={{ height: `${Math.max(m.share * 0.5, 3)}px` }}
                  title={`${m.count} keyword${m.count === 1 ? "" : "s"} peak in ${m.month} · ${formatCompact(m.volume)}/mo`}
                />
                <span className="text-[9px] text-subtle">{m.month}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 rounded-xl border border-line bg-surface px-4 py-3">
        {(
          [
            ["rising", `Rising (${buckets.rising.length})`],
            ["falling", `Falling (${buckets.falling.length})`],
            ["seasonal", `Seasonal (${buckets.seasonal.length})`],
          ] as Array<[View, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`min-h-7 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              view === key
                ? "border-brand-soft/50 bg-brand-soft/15 text-brand-soft"
                : "border-line text-subtle hover:text-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-subtle">
          Quarter-over-quarter change · ±10% counts as flat
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="search"
          title={`No ${view} keywords`}
          hint={
            view === "seasonal"
              ? "Nothing in this set shows a strong enough yearly pattern to call seasonal."
              : "Movement below 10% quarter-over-quarter is treated as noise rather than a trend."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div
            className="grid items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle"
            style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 70px 70px minmax(120px,160px)" }}
          >
            <span>Keyword</span>
            <span className="text-right">Volume</span>
            <span>Trend</span>
            <span className="text-right">Change</span>
            <span>{view === "seasonal" ? "Peaks" : "12 months"}</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            {rows.map((r) => (
              <div
                key={r.projectKeywordId}
                className="grid items-center gap-3 border-b border-line/50 px-4 py-2.5 text-xs"
                style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 70px 70px minmax(120px,160px)" }}
              >
                <span className="truncate text-ink" title={r.text}>{r.text}</span>
                <span className="nums text-right text-muted">{formatNumber(r.volume)}</span>
                <span><Sparkline points={r.trend} /></span>
                <span className="text-right">
                  <ChangeBadge direction={r.trendDirection} percent={r.trendChangePercent} />
                </span>
                <span className="flex flex-wrap gap-1">
                  {view === "seasonal" && r.peakMonths.length > 0 ? (
                    r.peakMonths.map((m) => <Pill key={m}>{m}</Pill>)
                  ) : r.isSeasonal ? (
                    <Pill tone="brand">seasonal</Pill>
                  ) : (
                    <span className="text-subtle">evergreen</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
