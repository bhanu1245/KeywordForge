"use client";

import { useState } from "react";
import type { ClusterView, ContentBriefView } from "@/lib/types";
import { BriefDialog } from "./BriefDialog";
import { Icon } from "./Icon";
import {
  Button,
  DifficultyCell,
  EmptyState,
  IntentBadge,
  Pill,
  formatCompact,
  formatNumber,
} from "./ui";

/**
 * Cluster list and the entry point to a content brief (PRD §8 flows 2 and 3).
 *
 * Collapsed by default: a 300-keyword project produces dozens of clusters, and
 * the job here is scanning head terms and combined volume, not reading every
 * member. Expanding is a disclosure, so the row is a real <button>.
 */
export function ClusterPanel({
  clusters,
  onRegenerate,
  busy,
}: {
  clusters: ClusterView[];
  onRegenerate: (threshold: number, minClusterSize: number) => void;
  busy: boolean;
}) {
  const [threshold, setThreshold] = useState(0.34);
  const [minSize, setMinSize] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [brief, setBrief] = useState<ContentBriefView | null>(null);
  const [briefFor, setBriefFor] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const totalKeywords = clusters.reduce((n, c) => n + c.keywordCount, 0);
  const totalVolume = clusters.reduce((n, c) => n + c.totalVolume, 0);
  const biggest = clusters[0]?.totalVolume || 1;

  async function generateBrief(cluster: ClusterView) {
    setBriefLoading(true);
    setBriefFor(cluster.name);
    setBrief(null);
    try {
      const res = await fetch("/api/v1/briefs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterId: cluster.id }),
      });
      const json = await res.json();
      if (res.ok) setBrief(json.brief as ContentBriefView);
      else setBriefFor(null);
    } catch {
      setBriefFor(null);
    } finally {
      setBriefLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="space-y-1">
          <label htmlFor="kf-tight" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Tightness
          </label>
          <div className="flex h-8 items-center gap-2">
            <input
              id="kf-tight"
              type="range"
              min={10}
              max={80}
              value={threshold * 100}
              onChange={(e) => setThreshold(Number(e.target.value) / 100)}
              className="w-32 cursor-pointer"
            />
            <span className="nums w-9 text-xs font-medium text-ink">{threshold.toFixed(2)}</span>
          </div>
          <p className="text-[10px] text-subtle">Higher = more, tighter clusters</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="kf-minsize" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Min size
          </label>
          <input
            id="kf-minsize"
            type="number"
            min={1}
            max={50}
            value={minSize}
            onChange={(e) => setMinSize(Math.max(1, Number(e.target.value)))}
            className="nums h-8 w-16 rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-brand-soft"
          />
          <p className="text-[10px] text-subtle">Smaller groups fold in</p>
        </div>

        <Button onClick={() => onRegenerate(threshold, minSize)} loading={busy} icon="layers">
          {busy ? "Clustering…" : "Regenerate"}
        </Button>

        <div className="ml-auto flex items-center gap-3 text-xs text-subtle">
          <Pill>{clusters.length} clusters</Pill>
          <Pill>{formatNumber(totalKeywords)} keywords</Pill>
          <Pill tone="brand">{formatCompact(totalVolume)}/mo</Pill>
        </div>
      </div>

      {clusters.length === 0 ? (
        <EmptyState
          icon="layers"
          title="No clusters yet"
          hint="Discover some keywords first, then regenerate clusters to group them into topics you can build pages around."
        />
      ) : (
        <div className="space-y-1.5">
          {clusters.map((cluster) => {
            const open = expanded === cluster.id;
            const share = Math.round((cluster.totalVolume / biggest) * 100);

            return (
              <div
                key={cluster.id}
                className={`overflow-hidden rounded-xl border bg-surface transition-colors ${
                  open ? "border-line-strong" : "border-line hover:border-line-strong"
                }`}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : cluster.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
                  >
                    <Icon
                      name={open ? "chevronDown" : "chevronRight"}
                      size={14}
                      className="shrink-0 text-subtle"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {cluster.name}
                    </span>
                  </button>

                  <IntentBadge intent={cluster.intent} />

                  <span className="nums hidden w-16 text-right text-xs text-subtle sm:block">
                    {formatNumber(cluster.keywordCount)} kw
                  </span>

                  {/* Volume bar makes relative cluster size scannable without
                      reading every number. */}
                  <div className="hidden w-28 items-center gap-2 md:flex">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                      <span
                        className="block h-full rounded-full bg-brand-soft/70"
                        style={{ width: `${Math.max(share, 3)}%` }}
                      />
                    </span>
                    <span className="nums w-12 text-right text-xs text-muted">
                      {formatCompact(cluster.totalVolume)}
                    </span>
                  </div>

                  <div className="hidden w-24 lg:block">
                    <DifficultyCell value={Math.round(cluster.avgDifficulty)} />
                  </div>

                  <Button
                    variant="outline"
                    icon="sparkles"
                    onClick={() => void generateBrief(cluster)}
                    disabled={briefLoading}
                  >
                    Brief
                  </Button>
                </div>

                {open && (
                  <div className="border-t border-line bg-canvas/50 px-3 py-1">
                    {cluster.keywords.map((kw) => (
                      <div
                        key={kw.id}
                        className="flex items-center gap-3 border-b border-line/40 py-1.5 text-xs last:border-0"
                      >
                        <span className="min-w-0 flex-1 truncate pl-6 text-muted">
                          {kw.text}
                          {kw.isPrimary && (
                            <span className="ml-2 rounded bg-brand-soft/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand-soft">
                              head
                            </span>
                          )}
                        </span>
                        <IntentBadge intent={kw.intent} />
                        <span className="nums w-16 text-right text-subtle">
                          {formatNumber(kw.volume)}
                        </span>
                        <span className="nums w-8 text-right text-subtle">
                          {kw.difficulty ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {briefFor && (
        <BriefDialog
          clusterName={briefFor}
          brief={brief}
          loading={briefLoading}
          onClose={() => {
            setBrief(null);
            setBriefFor(null);
          }}
        />
      )}
    </div>
  );
}
