"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { TimeSeriesChart, type ChartPoint } from "./TimeSeriesChart";
import { EmptyState, Pill, formatCompact, formatNumber } from "./ui";

/**
 * Historical Data (PRD §7 module 32).
 *
 * The data has accrued since Phase 1; this is the read side. The important UX
 * decision is the sparse case: a project created today has one reading, and a
 * one-point chart looks broken rather than new. So the panel counts what
 * exists and explains that history builds up, instead of rendering an empty
 * axis frame.
 */

interface ProjectHistory {
  dataPoints: number;
  firstSeen: string | null;
  trackedKeywords: number;
  serpChecks: number;
  rankChecks: number;
  totalVolume: ChartPoint[];
  avgDifficulty: ChartPoint[];
  avgPosition: ChartPoint[];
  topTen: ChartPoint[];
  keywords: Array<{ keywordId: string; text: string; dataPoints: number }>;
}

interface KeywordHistory {
  keywordId: string;
  text: string;
  dataPoints: number;
  firstSeen: string | null;
  lastSeen: string | null;
  volume: ChartPoint[];
  difficulty: ChartPoint[];
  position: ChartPoint[];
  serpChecks: number;
}

export function HistoryPanel({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectHistory | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<KeywordHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/history?projectId=${projectId}`);
      if (res.ok) setProject((await res.json()) as ProjectHistory);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openKeyword(keywordId: string) {
    setSelected(keywordId);
    setKeyword(null);
    const res = await fetch(`/api/v1/history?projectId=${projectId}&keywordId=${keywordId}`);
    if (res.ok) setKeyword((await res.json()).history as KeywordHistory);
  }

  if (loading) return <div className="skeleton h-64 rounded-xl" />;

  if (!project || project.trackedKeywords === 0) {
    return (
      <EmptyState
        icon="table"
        title="No keywords to track yet"
        hint="History accumulates from the moment you add keywords. Discover some first — every volume lookup and rank check is recorded from then on."
      />
    );
  }

  /**
   * One day of readings is not a trend. Saying so plainly beats drawing a flat
   * line that implies nothing has changed.
   */
  const thin = project.dataPoints < 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <Pill tone={thin ? "warn" : "brand"}>
          {project.dataPoints} day{project.dataPoints === 1 ? "" : "s"} on record
        </Pill>
        <Pill>{formatNumber(project.trackedKeywords)} keywords</Pill>
        <Pill>{formatNumber(project.serpChecks)} SERP checks</Pill>
        <Pill>{formatNumber(project.rankChecks)} rank checks</Pill>
        {project.firstSeen && (
          <span className="ml-auto text-[11px] text-subtle">since {project.firstSeen}</span>
        )}
      </div>

      {thin && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-xs text-warning">
          <Icon name="alert" size={14} className="mt-0.5" />
          <div>
            <p className="font-medium">History builds over time as you track this project.</p>
            <p className="mt-0.5 text-[11px] opacity-90">
              There is only {project.dataPoints === 0 ? "no data" : "one day of data"} so far.
              Volume is recorded on every discovery, and positions on every rank check — run
              those over days or weeks and these charts fill in. Nothing is missing; it simply
              has not happened yet.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-4">
          <TimeSeriesChart
            points={project.totalVolume}
            label="Total search volume"
            format={(v) => `${formatCompact(v)}/mo`}
          />
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <TimeSeriesChart
            points={project.avgDifficulty}
            label="Average difficulty"
            color="var(--color-hard)"
            format={(v) => v.toFixed(1)}
          />
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <TimeSeriesChart
            points={project.avgPosition}
            label="Average position"
            color="var(--color-easy)"
            // Lower is better, so the axis is flipped — an improving line
            // should go UP, which is what everyone reads as good.
            invert
            format={(v) => `#${v.toFixed(1)}`}
          />
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <TimeSeriesChart
            points={project.topTen}
            label="Keywords in the top 10"
            color="var(--color-transactional)"
            format={(v) => formatNumber(v)}
          />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
            Per-keyword history
          </div>
          <div className="max-h-[420px] overflow-auto">
            {project.keywords.map((k) => (
              <button
                key={k.keywordId}
                type="button"
                onClick={() => openKeyword(k.keywordId)}
                className={`flex w-full items-center gap-3 border-b border-line/50 px-4 py-2.5 text-left text-xs transition-colors hover:bg-elevated ${
                  selected === k.keywordId ? "bg-elevated" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-ink">{k.text}</span>
                <span className="nums shrink-0 text-subtle">
                  {k.dataPoints} pt{k.dataPoints === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          {!keyword ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-center text-xs text-subtle">
              Select a keyword to see its own history.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{keyword.text}</span>
                <Pill>{keyword.dataPoints} readings</Pill>
                {keyword.serpChecks > 0 && <Pill>{keyword.serpChecks} SERPs</Pill>}
              </div>
              <TimeSeriesChart
                points={keyword.volume}
                label="Search volume"
                height={120}
                format={(v) => formatCompact(v)}
              />
              <TimeSeriesChart
                points={keyword.position}
                label="Ranking position"
                color="var(--color-easy)"
                invert
                height={120}
                format={(v) => `#${v}`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
