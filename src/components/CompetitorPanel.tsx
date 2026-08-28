"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CompetitorKeywordView,
  CompetitorSummaryView,
  ContentGapView,
} from "@/lib/types";
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
 * Competitor Keywords, Keyword Gap and Content Gap
 * (PRD §7 modules 12, 13, 14).
 *
 * These are derived from the SERPs this project has actually collected, not
 * from a crawl index — so the panel says so plainly rather than implying
 * Ahrefs-like coverage. Overstating what the data means is how an agency
 * makes a bad promise in a pitch.
 */

type View = "landscape" | "keywords" | "gap";

const OPPORTUNITY_STYLES: Record<CompetitorKeywordView["opportunity"], string> = {
  gap: "border-extreme/30 bg-extreme/10 text-extreme",
  behind: "border-medium/30 bg-medium/10 text-medium",
  ahead: "border-easy/30 bg-easy/10 text-easy",
};

const OPPORTUNITY_LABEL = {
  gap: "Gap",
  behind: "Behind",
  ahead: "Ahead",
} as const;

export function CompetitorPanel({
  projectId,
  hasSerpData,
}: {
  projectId: string;
  hasSerpData: boolean;
}) {
  const [view, setView] = useState<View>("landscape");
  const [landscape, setLandscape] = useState<CompetitorSummaryView[]>([]);
  const [ownDomain, setOwnDomain] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<CompetitorKeywordView[]>([]);
  const [gap, setGap] = useState<ContentGapView[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [loading, setLoading] = useState(false);

  const loadLandscape = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/competitors?projectId=${projectId}&view=landscape`);
      if (res.ok) {
        const json = await res.json();
        setLandscape(json.competitors as CompetitorSummaryView[]);
        setOwnDomain(json.ownDomain as string | null);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadLandscape();
  }, [loadLandscape]);

  async function openCompetitor(domain: string) {
    setSelected(domain);
    setView("keywords");
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/competitors?projectId=${projectId}&view=keywords&domain=${encodeURIComponent(domain)}`,
      );
      if (res.ok) setKeywords((await res.json()).keywords as CompetitorKeywordView[]);
    } finally {
      setLoading(false);
    }
  }

  async function openGap() {
    setView("gap");
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/competitors?projectId=${projectId}&view=gap`);
      if (res.ok) setGap((await res.json()).clusters as ContentGapView[]);
    } finally {
      setLoading(false);
    }
  }

  async function track(domain: string, on: boolean) {
    await fetch("/api/v1/competitors", {
      method: on ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, domain }),
    });
    await loadLandscape();
  }

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!newDomain.trim()) return;
    await track(newDomain.trim(), true);
    setNewDomain("");
  }

  if (!hasSerpData) {
    return (
      <EmptyState
        icon="target"
        title="Competitor analysis needs SERP data first"
        hint="Run a SERP analysis on the SERP tab. Competitors are derived from who actually ranks for your keywords, so there is nothing to compare until those SERPs exist."
      />
    );
  }

  const gapCount = keywords.filter((k) => k.opportunity === "gap").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-1">
          {(
            [
              ["landscape", "Landscape"],
              ["keywords", "Keyword gap"],
              ["gap", "Content gap"],
            ] as Array<[View, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === "gap") void openGap();
                else if (key === "landscape") setView("landscape");
                else if (selected) void openCompetitor(selected);
                else setView("keywords");
              }}
              className={`min-h-7 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                view === key
                  ? "border-brand-soft/50 bg-brand-soft/15 text-brand-soft"
                  : "border-line text-subtle hover:text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={addDomain} className="ml-auto flex items-center gap-2">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="Track a domain…"
            aria-label="Competitor domain to track"
            className="h-8 w-48 rounded-lg border border-line bg-canvas px-3 text-xs text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft"
          />
          <Button type="submit" variant="outline" icon="plus" disabled={!newDomain.trim()}>
            Track
          </Button>
        </form>
      </div>

      {/* Scope caveat — the data is real but bounded, and that must be visible. */}
      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-subtle">
        <Icon name="help" size={12} className="mt-0.5" />
        Derived from SERPs collected for <em>this project&apos;s</em> keywords — not a full
        crawl of each competitor. A competitor may rank for terms you have not analysed.
        {ownDomain ? (
          <> Your domain: <strong className="text-muted">{ownDomain}</strong>.</>
        ) : (
          <> Set a project domain to see where <em>you</em> rank.</>
        )}
      </p>

      {loading && <div className="skeleton h-24 rounded-xl" />}

      {!loading && view === "landscape" && (
        landscape.length === 0 ? (
          <EmptyState icon="target" title="No competitors found in the analysed SERPs yet" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div
              className="grid items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle"
              style={{ gridTemplateColumns: "minmax(160px,1fr) 90px 90px 80px 70px 80px" }}
            >
              <span>Domain</span>
              <span className="text-right">Keywords</span>
              <span className="text-right">Volume</span>
              <span className="text-right">Avg pos</span>
              <span className="text-right">Top 3</span>
              <span className="text-right">Track</span>
            </div>
            {landscape.map((c) => {
              const isOwn = ownDomain === c.domain;
              return (
                <div
                  key={c.domain}
                  className="grid items-center gap-3 border-b border-line/50 px-4 py-2.5 text-xs transition-colors hover:bg-elevated"
                  style={{ gridTemplateColumns: "minmax(160px,1fr) 90px 90px 80px 70px 80px" }}
                >
                  <button
                    type="button"
                    onClick={() => openCompetitor(c.domain)}
                    className="flex min-w-0 items-center gap-2 rounded text-left"
                  >
                    <span className="truncate text-ink hover:text-brand-soft">{c.domain}</span>
                    {isOwn && <Pill tone="brand">you</Pill>}
                  </button>
                  <span className="nums text-right text-muted">{formatNumber(c.keywordCount)}</span>
                  <span className="nums text-right text-muted">{formatCompact(c.totalVolume)}</span>
                  <span className="nums text-right text-muted">{c.averagePosition}</span>
                  <span className="nums text-right text-muted">{c.topThree}</span>
                  <div className="text-right">
                    {!isOwn && (
                      <button
                        type="button"
                        onClick={() => track(c.domain, !c.tracked)}
                        aria-pressed={c.tracked}
                        className={`min-h-6 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                          c.tracked
                            ? "border-brand-soft/40 bg-brand-soft/15 text-brand-soft"
                            : "border-line text-subtle hover:text-muted"
                        }`}
                      >
                        {c.tracked ? "Tracked" : "Track"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {!loading && view === "keywords" && (
        !selected ? (
          <EmptyState icon="target" title="Pick a competitor from the Landscape tab" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2.5">
              <span className="text-xs font-semibold text-ink">{selected}</span>
              <Pill>{formatNumber(keywords.length)} shared keywords</Pill>
              {gapCount > 0 && (
                <span className="rounded-full border border-extreme/30 bg-extreme/10 px-2 py-0.5 text-[10px] font-medium text-extreme">
                  {formatNumber(gapCount)} gaps
                </span>
              )}
            </div>
            <div className="max-h-[560px] overflow-auto">
              {keywords.map((k) => (
                <div
                  key={k.keywordId}
                  className="grid items-center gap-3 border-b border-line/50 px-4 py-2.5 text-xs"
                  style={{ gridTemplateColumns: "minmax(180px,1fr) 80px 104px 100px 70px 70px 70px" }}
                >
                  <span className="truncate text-ink" title={k.text}>{k.text}</span>
                  <span className="nums text-right text-muted">{formatNumber(k.volume)}</span>
                  <span>{k.difficulty !== null ? <DifficultyCell value={k.difficulty} /> : "—"}</span>
                  <span><IntentBadge intent={k.intent} /></span>
                  <span className="nums text-right text-muted" title="Their position">
                    #{k.competitorPosition}
                  </span>
                  <span className="nums text-right text-muted" title="Your position">
                    {k.ownPosition ? `#${k.ownPosition}` : "—"}
                  </span>
                  <span className="text-right">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${OPPORTUNITY_STYLES[k.opportunity]}`}>
                      {OPPORTUNITY_LABEL[k.opportunity]}
                    </span>
                  </span>
                </div>
              ))}
              {keywords.length === 0 && (
                <p className="px-4 py-12 text-center text-xs text-subtle">
                  This domain does not rank in any analysed SERP.
                </p>
              )}
            </div>
          </div>
        )
      )}

      {!loading && view === "gap" && (
        gap.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No content gaps found"
            hint="Either you rank across the analysed clusters, or clusters have not been generated yet."
          />
        ) : (
          <div className="space-y-1.5">
            {gap.map((c) => (
              <div key={c.clusterId} className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.name}</span>
                  <IntentBadge intent={c.intent} />
                  <span className="nums text-xs text-muted">
                    {formatNumber(c.gapKeywords)}/{formatNumber(c.keywordCount)} missing
                  </span>
                  <span className="nums text-xs font-medium text-brand-soft">
                    {formatCompact(c.gapVolume)}/mo unclaimed
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                    <span
                      className="block h-full rounded-full bg-extreme/70"
                      style={{ width: `${Math.max(c.gapScore, 2)}%` }}
                    />
                  </span>
                  <span className="nums w-10 text-right text-[11px] text-muted">{c.gapScore}%</span>
                </div>
                {c.competitorsPresent.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-subtle">Ranking here:</span>
                    {c.competitorsPresent.map((d) => (
                      <Pill key={d}>{d}</Pill>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
