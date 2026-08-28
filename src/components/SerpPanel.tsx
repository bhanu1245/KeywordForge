"use client";

import { useState } from "react";
import type { JobView, SerpCoverageView, SerpDetailView } from "@/lib/types";
import { Icon } from "./Icon";
import { Button, EmptyState, Pill, formatCompact, formatNumber } from "./ui";

/**
 * SERP Analyzer + SERP Features (PRD §7 modules 11 and 18).
 *
 * The cost warning is deliberate and prominent: unlike every other panel,
 * pressing the button here spends money on a live provider — one call per
 * keyword. Hiding that behind a friendly "Analyze" button would be how an
 * agency accidentally burns a month's budget.
 */

const FEATURE_LABELS: Record<string, string> = {
  featured_snippet: "Featured snippet",
  people_also_ask: "People also ask",
  local_pack: "Local pack",
  image_pack: "Image pack",
  video: "Video",
  shopping: "Shopping",
  top_stories: "Top stories",
  sitelinks: "Sitelinks",
  reviews: "Reviews",
};

const label = (f: string) => FEATURE_LABELS[f] ?? f.replace(/_/g, " ");

function strengthTone(v: number | null): string {
  if (v === null) return "text-subtle";
  if (v >= 70) return "text-extreme";
  if (v >= 50) return "text-hard";
  if (v >= 30) return "text-medium";
  return "text-easy";
}

export function SerpPanel({
  projectId,
  coverage,
  onRefresh,
  isLiveProvider,
}: {
  projectId: string;
  coverage: SerpCoverageView | null;
  onRefresh: () => void;
  isLiveProvider: boolean;
}) {
  const [limit, setLimit] = useState(25);
  const [job, setJob] = useState<JobView | null>(null);
  const [detail, setDetail] = useState<SerpDetailView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = job?.status === "queued" || job?.status === "running";

  async function analyze() {
    setError(null);
    try {
      const res = await fetch("/api/v1/serp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, limit }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not start SERP analysis.");
        return;
      }
      for (;;) {
        const next = (await (await fetch(`/api/v1/jobs/${json.jobId}`)).json()) as JobView;
        setJob(next);
        if (next.status === "completed") {
          onRefresh();
          return;
        }
        if (next.status === "failed") {
          setError(next.error ?? "SERP analysis failed.");
          return;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch {
      setError("Could not reach the server.");
    }
  }

  async function openKeyword(keywordId: string) {
    setSelected(keywordId);
    setDetail(null);
    const res = await fetch(`/api/v1/serp?projectId=${projectId}&keywordId=${keywordId}`);
    if (res.ok) setDetail((await res.json()).serp as SerpDetailView);
  }

  const analyzed = coverage?.analyzed ?? 0;
  const total = coverage?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Run control */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="space-y-1">
          <label htmlFor="serp-limit" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Keywords to analyse
          </label>
          <input
            id="serp-limit"
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value))))}
            className="nums h-8 w-20 rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-brand-soft"
          />
          <p className="text-[10px] text-subtle">Highest volume first</p>
        </div>

        <Button onClick={analyze} loading={running} icon="search">
          {running ? "Analysing…" : "Run SERP analysis"}
        </Button>

        {/* One paid call per keyword — say so before the click, not after. */}
        <span
          className="inline-flex items-center gap-1.5 text-[11px] text-warning"
          title="Each keyword costs one SERP call from your data provider."
        >
          <Icon name="alert" size={12} />
          {isLiveProvider
            ? `${limit} billable SERP call${limit === 1 ? "" : "s"}`
            : "Free on sample data — billable once a live provider is connected"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Pill tone={analyzed > 0 ? "brand" : "neutral"}>
            {formatNumber(analyzed)} / {formatNumber(total)} analysed
          </Pill>
        </div>
      </div>

      {running && job && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-ink">
              <Icon name="spinner" size={13} className="animate-spin text-brand-soft" />
              Fetching SERPs
            </span>
            <span className="nums text-muted">
              {formatNumber(job.progress)} / {formatNumber(job.total)} · {job.percent}%
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={job.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-brand-soft transition-all duration-300"
              style={{ width: `${job.percent}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
          <Icon name="alert" size={14} />
          {error}
        </div>
      )}

      {analyzed === 0 ? (
        <EmptyState
          icon="search"
          title="No SERPs analysed yet"
          hint="Run an analysis to see who ranks, which SERP features appear, and to upgrade difficulty scores with real SERP data."
        />
      ) : (
        <>
          {/* SERP features (module 18) */}
          {coverage && coverage.features.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h3 className="text-xs font-semibold text-ink">SERP features</h3>
              <p className="mt-0.5 text-[11px] text-muted">
                Share of the {formatNumber(analyzed)} analysed keywords showing each feature.
              </p>
              <div className="mt-3 space-y-2">
                {coverage.features.map((f) => (
                  <div key={f.feature} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 truncate text-xs capitalize text-muted">
                      {label(f.feature)}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                      <span
                        className="block h-full rounded-full bg-brand-soft/70"
                        style={{ width: `${Math.max(f.share, 2)}%` }}
                      />
                    </span>
                    <span className="nums w-16 text-right text-xs text-muted">
                      {f.share}% · {f.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            {/* Analysed keywords */}
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
                Analysed keywords
              </div>
              <div className="max-h-[520px] overflow-auto">
                {coverage?.analyzedKeywords.map((k) => (
                  <button
                    key={k.keywordId}
                    type="button"
                    onClick={() => openKeyword(k.keywordId)}
                    className={`flex w-full items-center gap-3 border-b border-line/50 px-4 py-2.5 text-left text-xs transition-colors hover:bg-elevated ${
                      selected === k.keywordId ? "bg-elevated" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-ink">{k.text}</span>
                    {k.features.length > 0 && (
                      <span className="nums shrink-0 rounded bg-brand-soft/15 px-1.5 py-0.5 text-[9px] font-medium text-brand-soft">
                        {k.features.length} feat
                      </span>
                    )}
                    <span className="nums w-14 shrink-0 text-right text-muted">
                      {formatNumber(k.volume)}
                    </span>
                    <span
                      className={`nums w-8 shrink-0 text-right font-medium ${strengthTone(k.meanStrength)}`}
                      title="Mean authority of the top 10"
                    >
                      {k.meanStrength ?? "—"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* SERP detail */}
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">
                {detail ? `Top 10 — ${detail.keyword}` : "Select a keyword"}
              </div>

              {!detail ? (
                <div className="px-4 py-16 text-center text-xs text-subtle">
                  Pick a keyword to see who ranks for it.
                </div>
              ) : (
                <>
                  {detail.features.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
                      {detail.features.map((f) => (
                        <Pill key={f} tone="brand">{label(f)}</Pill>
                      ))}
                    </div>
                  )}
                  <div className="max-h-[460px] overflow-auto">
                    {detail.results.map((r) => (
                      <div
                        key={`${r.position}-${r.url}`}
                        className="flex items-start gap-3 border-b border-line/50 px-4 py-2.5"
                      >
                        <span className="nums w-5 shrink-0 pt-0.5 text-xs font-semibold text-subtle">
                          {r.position}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-ink">{r.title}</div>
                          <div className="mt-0.5 truncate text-[11px] text-brand-soft">{r.domain}</div>
                        </div>
                        {typeof r.domainStrength === "number" && (
                          <span
                            className={`nums shrink-0 text-xs font-medium ${strengthTone(r.domainStrength)}`}
                            title="Domain authority proxy — provider-supplied, not a licensed index"
                          >
                            {r.domainStrength}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
