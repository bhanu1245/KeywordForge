"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobView } from "@/lib/types";
import { Icon } from "./Icon";
import { Button, EmptyState, Pill, formatNumber } from "./ui";

/**
 * Rank Tracker, Cannibalisation and Alerts
 * (PRD §7 modules 21, 26, 29) — the "how are we doing" surface.
 *
 * Grouped into one tab because they share a data source: a rank check
 * refreshes SERPs, records positions, then evaluates alerts against the
 * movement. Splitting them across three tabs would imply three separate
 * actions when there is really one.
 */

interface RankRow {
  keywordId: string;
  text: string;
  volume: number | null;
  position: number | null;
  previousPosition: number | null;
  change: number | null;
  url: string | null;
}

interface RankSummary {
  ownDomain: string | null;
  tracked: number;
  ranking: number;
  topThree: number;
  topTen: number;
  improved: number;
  declined: number;
  averagePosition: number | null;
  rows: RankRow[];
}

interface CannibalRow {
  keywordId: string;
  text: string;
  volume: number | null;
  urls: Array<{ url: string; position: number }>;
  bestPosition: number;
  spread: number;
}

interface AlertView {
  id: string;
  type: string;
  label: string;
  threshold: number;
  enabled: boolean;
  unacknowledged: number;
  events: Array<{ id: string; message: string; acknowledged: boolean; createdAt: string }>;
}

const ALERT_PRESETS: Array<{ type: string; label: string; threshold: number; hint: string }> = [
  { type: "rank_drop", label: "Rank drop", threshold: 3, hint: "Fires when a keyword falls this many positions" },
  { type: "rank_gain", label: "Rank gain", threshold: 3, hint: "Fires when a keyword climbs this many positions" },
  { type: "lost_ranking", label: "Fell out of top 10", threshold: 1, hint: "Fires when a page stops getting clicks" },
  { type: "new_competitor", label: "New competitor", threshold: 3, hint: "Fires when a new domain ranks for this many of your keywords" },
];

function ChangeCell({ change }: { change: number | null }) {
  if (change === null || change === 0) {
    return <span className="text-subtle">—</span>;
  }
  const improved = change > 0;
  return (
    <span className={`nums inline-flex items-center gap-0.5 ${improved ? "text-easy" : "text-extreme"}`}>
      <Icon name={improved ? "arrowUp" : "arrowDown"} size={11} />
      {Math.abs(change)}
    </span>
  );
}

export function RankPanel({ projectId }: { projectId: string }) {
  const [view, setView] = useState<"rankings" | "cannibalisation" | "alerts">("rankings");
  const [summary, setSummary] = useState<RankSummary | null>(null);
  const [cannibal, setCannibal] = useState<CannibalRow[]>([]);
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);

  const load = useCallback(async () => {
    const [s, c, a] = await Promise.all([
      fetch(`/api/v1/rank-tracking?projectId=${projectId}`),
      fetch(`/api/v1/rank-tracking?projectId=${projectId}&view=cannibalisation`),
      fetch(`/api/v1/alerts?projectId=${projectId}`),
    ]);
    if (s.ok) setSummary((await s.json()) as RankSummary);
    if (c.ok) setCannibal((await c.json()).rows as CannibalRow[]);
    if (a.ok) setAlerts((await a.json()).alerts as AlertView[]);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = job?.status === "queued" || job?.status === "running";

  async function runCheck() {
    setError(null);
    try {
      const res = await fetch("/api/v1/rank-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, limit }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not start the rank check.");
        return;
      }
      for (;;) {
        const next = (await (await fetch(`/api/v1/jobs/${json.jobId}`)).json()) as JobView;
        setJob(next);
        if (next.status === "completed") {
          await load();
          return;
        }
        if (next.status === "failed") {
          setError(next.error ?? "Rank check failed.");
          return;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch {
      setError("Could not reach the server.");
    }
  }

  async function toggleAlert(type: string, threshold: number) {
    await fetch("/api/v1/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, type, threshold }),
    });
    await load();
  }

  async function acknowledge(alertId: string) {
    await fetch("/api/v1/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, alertId, acknowledge: true }),
    });
    await load();
  }

  if (summary && !summary.ownDomain) {
    return (
      <EmptyState
        icon="target"
        title="Set a project domain to track rankings"
        hint="Rank tracking compares your domain's position against the SERPs collected for this project — without a domain there is no “you” to track."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-1">
          {(
            [
              ["rankings", "Rankings"],
              ["cannibalisation", `Cannibalisation${cannibal.length ? ` (${cannibal.length})` : ""}`],
              ["alerts", "Alerts"],
            ] as Array<[typeof view, string]>
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
        </div>

        <div className="ml-auto flex items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="rank-limit" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
              Keywords
            </label>
            <input
              id="rank-limit"
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value))))}
              className="nums h-8 w-20 rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink outline-none focus:border-brand-soft"
            />
          </div>
          <Button onClick={runCheck} loading={running} icon="target">
            {running ? "Checking…" : "Run rank check"}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
          <Icon name="alert" size={14} />
          {error}
        </div>
      )}

      {running && job && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-ink">
              <Icon name="spinner" size={13} className="animate-spin text-brand-soft" />
              Refreshing SERPs and recording positions
            </span>
            <span className="nums text-muted">{job.percent}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={job.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand-soft transition-all duration-300" style={{ width: `${job.percent}%` }} />
          </div>
        </div>
      )}

      {view === "rankings" && (
        summary === null || summary.tracked === 0 ? (
          <EmptyState
            icon="target"
            title="No rank history yet"
            hint="Run a rank check to record where you currently sit. Movement appears from the second check onward — the first has nothing to compare against."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Tracked", formatNumber(summary.tracked), ""],
                ["Ranking", formatNumber(summary.ranking), ""],
                ["Top 3", formatNumber(summary.topThree), "text-easy"],
                ["Top 10", formatNumber(summary.topTen), ""],
                ["Improved", formatNumber(summary.improved), "text-easy"],
                ["Declined", formatNumber(summary.declined), "text-extreme"],
              ].map(([label, value, tone]) => (
                <div key={label} className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
                  <div className={`nums mt-0.5 text-lg font-semibold ${tone || "text-ink"}`}>{value}</div>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div
                className="grid items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle"
                style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 70px 70px 80px" }}
              >
                <span>Keyword</span>
                <span className="text-right">Volume</span>
                <span className="text-right">Position</span>
                <span className="text-right">Was</span>
                <span className="text-right">Change</span>
              </div>
              <div className="max-h-[520px] overflow-auto">
                {summary.rows.map((r) => (
                  <div
                    key={r.keywordId}
                    className="grid items-center gap-3 border-b border-line/50 px-4 py-2.5 text-xs"
                    style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 70px 70px 80px" }}
                  >
                    <span className="truncate text-ink" title={r.url ?? r.text}>{r.text}</span>
                    <span className="nums text-right text-muted">{formatNumber(r.volume)}</span>
                    <span className={`nums text-right font-medium ${r.position === null ? "text-subtle" : r.position <= 3 ? "text-easy" : r.position <= 10 ? "text-ink" : "text-muted"}`}>
                      {r.position === null ? "not ranking" : `#${r.position}`}
                    </span>
                    <span className="nums text-right text-subtle">
                      {r.previousPosition === null ? "—" : `#${r.previousPosition}`}
                    </span>
                    <span className="text-right"><ChangeCell change={r.change} /></span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      )}

      {view === "cannibalisation" && (
        cannibal.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No cannibalisation detected"
            hint="This finds keywords where two of your own pages compete in the same SERP, splitting clicks and link equity. Run a SERP or rank check first."
          />
        ) : (
          <div className="space-y-1.5">
            {cannibal.map((row) => (
              <div key={row.keywordId} className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.text}</span>
                  <Pill tone="warn">{row.urls.length} competing pages</Pill>
                  <span className="nums text-xs text-muted">{formatNumber(row.volume)}/mo</span>
                </div>
                <div className="mt-2 space-y-1">
                  {row.urls.map((u) => (
                    <div key={u.url} className="flex items-center gap-3 text-[11px]">
                      <span className="nums w-8 shrink-0 text-right font-medium text-muted">#{u.position}</span>
                      <span className="min-w-0 flex-1 truncate text-subtle" title={u.url}>{u.url}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-subtle">
                  Consolidate into one page and redirect the weaker URL, or differentiate their targeting.
                </p>
              </div>
            ))}
          </div>
        )
      )}

      {view === "alerts" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="text-xs font-semibold text-ink">Alert rules</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              Evaluated automatically at the end of every rank check.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {ALERT_PRESETS.map((preset) => {
                const existing = alerts.find((a) => a.type === preset.type);
                const on = existing?.enabled ?? false;
                return (
                  <button
                    key={preset.type}
                    type="button"
                    onClick={() => toggleAlert(preset.type, existing?.threshold ?? preset.threshold)}
                    title={preset.hint}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      on ? "border-brand-soft/40 bg-brand-soft/10" : "border-line hover:border-line-strong"
                    }`}
                  >
                    <Icon name={on ? "check" : "plus"} size={14} className={on ? "text-brand-soft" : "text-subtle"} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-ink">{preset.label}</div>
                      <div className="truncate text-[10px] text-subtle">{preset.hint}</div>
                    </div>
                    {existing && existing.unacknowledged > 0 && (
                      <Pill tone="warn">{existing.unacknowledged}</Pill>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {alerts.filter((a) => a.events.length > 0).map((a) => (
            <div key={a.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-ink">{a.label}</h3>
                <Pill>{a.events.length} recent</Pill>
                {a.unacknowledged > 0 && (
                  <button
                    type="button"
                    onClick={() => acknowledge(a.id)}
                    className="ml-auto min-h-6 rounded-md border border-line px-2 py-1 text-[10px] text-muted transition-colors hover:text-ink"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="mt-2 space-y-1">
                {a.events.map((e) => (
                  <div
                    key={e.id}
                    className={`flex items-start gap-2 border-b border-line/40 py-1.5 text-[11px] last:border-0 ${
                      e.acknowledged ? "text-subtle" : "text-muted"
                    }`}
                  >
                    <Icon name="alert" size={11} className={e.acknowledged ? "mt-0.5 text-subtle" : "mt-0.5 text-warning"} />
                    <span className="flex-1">{e.message}</span>
                    <span className="shrink-0 text-subtle">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {alerts.every((a) => a.events.length === 0) && (
            <EmptyState
              icon="alert"
              title="No alerts have fired"
              hint="Enable a rule above, then run at least two rank checks — movement needs a previous check to compare against."
            />
          )}
        </div>
      )}
    </div>
  );
}
