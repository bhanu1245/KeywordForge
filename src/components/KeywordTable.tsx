"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeywordRow } from "@/lib/types";
import { Icon } from "./Icon";
import {
  DifficultyCell,
  EmptyState,
  IntentBadge,
  Sparkline,
  TableSkeleton,
  formatCurrency,
  formatNumber,
} from "./ui";

/**
 * Virtualised keyword table (PRD §9: "virtualized for 10K+ rows"). Only the
 * visible window is in the DOM, so 10K rows scroll like 100.
 *
 * Sorting is in-memory: the whole filtered set is already client-side, so a
 * server round trip per sort would add latency for nothing.
 *
 * ACCESSIBILITY: headers are real <button>s inside role="columnheader" with
 * aria-sort, so the current sort is announced rather than conveyed only by a
 * coloured arrow. The virtualised body uses explicit ARIA grid roles because
 * absolute positioning breaks the implicit table semantics.
 */

type SortKey =
  | "text"
  | "volume"
  | "difficulty"
  | "cpc"
  | "opportunity"
  | "trafficPotential"
  | "commercialValue";

interface Column {
  key: SortKey | "intent" | "trend";
  label: string;
  width: string;
  align?: "right";
  sortable?: boolean;
  hint?: string;
}

const COLUMNS: Column[] = [
  { key: "text", label: "Keyword", width: "minmax(220px,1fr)", sortable: true },
  { key: "volume", label: "Volume", width: "84px", align: "right", sortable: true },
  { key: "trend", label: "Trend", width: "64px" },
  {
    key: "difficulty",
    label: "KD",
    width: "104px",
    sortable: true,
    hint: "Difficulty proxy from competition, volume and phrase length — not an Ahrefs KD.",
  },
  { key: "intent", label: "Intent", width: "104px" },
  { key: "cpc", label: "CPC", width: "72px", align: "right", sortable: true },
  {
    key: "opportunity",
    label: "Opp.",
    width: "76px",
    align: "right",
    sortable: true,
    hint: "Opportunity: volume, winnability and commercial intent combined.",
  },
  {
    key: "trafficPotential",
    label: "Traffic",
    width: "80px",
    align: "right",
    sortable: true,
    hint: "Estimated monthly sessions at position 3.",
  },
  {
    key: "commercialValue",
    label: "Value/mo",
    width: "92px",
    align: "right",
    sortable: true,
    hint: "What that traffic would cost in Google Ads.",
  },
];

const GRID = COLUMNS.map((c) => c.width).join(" ");

/** Tints the opportunity score so the best rows are findable at a glance. */
function opportunityTone(score: number): string {
  if (score >= 65) return "text-easy";
  if (score >= 45) return "text-brand-soft";
  if (score >= 25) return "text-muted";
  return "text-subtle";
}

export function KeywordTable({
  rows,
  loading = false,
}: {
  rows: KeywordRow[];
  loading?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("opportunity");
  const [asc, setAsc] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" || typeof bv === "string") {
        return asc
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      }
      const an = (av as number | null) ?? -1;
      const bn = (bv as number | null) ?? -1;
      return asc ? an - bn : bn - an;
    });
    return copy;
  }, [rows, sortKey, asc]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 14,
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
      return;
    }
    setSortKey(key);
    // Text reads naturally A–Z; every metric reads best highest-first.
    setAsc(key === "text");
  }

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <TableSkeleton rows={10} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No keywords match these filters"
        hint="Loosen the difficulty ceiling or clear an intent filter to see more of the set."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      {/* Header */}
      <div
        role="row"
        className="grid items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle"
        style={{ gridTemplateColumns: GRID }}
      >
        {COLUMNS.map((col) => {
          const active = sortKey === col.key;
          const sortState = !col.sortable
            ? undefined
            : active
              ? asc
                ? ("ascending" as const)
                : ("descending" as const)
              : ("none" as const);

          return (
            <div
              key={col.key}
              role="columnheader"
              aria-sort={sortState}
              className={col.align === "right" ? "text-right" : ""}
            >
              {col.sortable ? (
                <button
                  type="button"
                  onClick={() => toggleSort(col.key as SortKey)}
                  title={col.hint}
                  className={`inline-flex items-center gap-1 rounded transition-colors hover:text-ink ${
                    col.align === "right" ? "flex-row-reverse" : ""
                  } ${active ? "text-brand-soft" : ""}`}
                >
                  {col.label}
                  <Icon
                    name={active && asc ? "arrowUp" : "arrowDown"}
                    size={11}
                    className={active ? "opacity-100" : "opacity-0"}
                  />
                </button>
              ) : (
                <span title={col.hint} className="inline-flex items-center gap-1">
                  {col.label}
                  {col.hint && <Icon name="help" size={10} className="opacity-50" />}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Virtualised body */}
      <div
        ref={parentRef}
        role="rowgroup"
        className="max-h-[calc(100dvh-340px)] min-h-[320px] overflow-auto"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = sorted[item.index];
            return (
              <div
                key={row.projectKeywordId}
                role="row"
                className="group absolute left-0 top-0 grid w-full items-center gap-3 border-b border-line/50 px-4 text-xs transition-colors hover:bg-elevated"
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                  gridTemplateColumns: GRID,
                }}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-ink" title={row.text}>
                    {row.text}
                  </span>
                  {row.isQuestion && (
                    <Icon
                      name="help"
                      size={11}
                      title="Question keyword"
                      className="shrink-0 text-subtle"
                    />
                  )}
                </div>

                <div className="nums text-right text-muted">{formatNumber(row.volume)}</div>
                <div><Sparkline points={row.trend} /></div>
                <DifficultyCell value={row.difficulty} />
                <div><IntentBadge intent={row.intent} /></div>
                <div className="nums text-right text-muted">
                  {row.cpc === null ? "—" : `$${row.cpc.toFixed(2)}`}
                </div>
                <div className={`nums text-right font-semibold ${opportunityTone(row.opportunity)}`}>
                  {row.opportunity}
                </div>
                <div className="nums text-right text-muted">
                  {formatNumber(row.trafficPotential)}
                </div>
                <div className="nums text-right text-muted">
                  {formatCurrency(row.commercialValue)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line bg-elevated/40 px-4 py-2 text-[11px] text-subtle">
        <span className="nums">{formatNumber(sorted.length)} keywords</span>
        <span>Sorted by {COLUMNS.find((c) => c.key === sortKey)?.label} · {asc ? "ascending" : "descending"}</span>
      </div>
    </div>
  );
}
