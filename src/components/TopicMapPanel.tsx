"use client";

import { useEffect, useState } from "react";
import type { TopicMapView } from "@/lib/types";
import { Icon } from "./Icon";
import { Button, EmptyState, IntentBadge, Pill, formatCompact } from "./ui";

/**
 * AI Topic Map (PRD §7 module 16).
 *
 * Renders the pillar/supporting hierarchy that turns a cluster list into a
 * build order. The `generatedBy` badge is shown for the same reason it is on
 * briefs: a strategist must know whether they are reading Claude's grouping or
 * the deterministic one before committing a content budget to it.
 */
export function TopicMapPanel({
  projectId,
  hasClusters,
}: {
  projectId: string;
  hasClusters: boolean;
}) {
  const [map, setMap] = useState<TopicMapView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/topic-map?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.map) setMap(json.map as TopicMapView);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/topic-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not build the topic map.");
        return;
      }
      setMap(json.map as TopicMapView);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasClusters) {
    return (
      <EmptyState
        icon="layers"
        title="Generate clusters first"
        hint="The topic map is built from your clusters — it groups them into pillar pages and the supporting content that links up to them."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <Button onClick={generate} loading={busy} icon="sparkles">
          {map ? "Rebuild topic map" : "Build topic map"}
        </Button>
        {map && (
          <>
            <Pill tone={map.generatedBy === "claude" ? "brand" : "neutral"}>
              <Icon name={map.generatedBy === "claude" ? "sparkles" : "layers"} size={10} />
              {map.generatedBy === "claude" ? "Claude" : "Rule-based"}
            </Pill>
            <Pill>{map.pillars.length} pillars</Pill>
          </>
        )}
        {error && (
          <span role="alert" className="inline-flex items-center gap-1.5 text-xs text-danger">
            <Icon name="alert" size={13} />
            {error}
          </span>
        )}
      </div>

      {loading && <div className="skeleton h-40 rounded-xl" />}

      {!loading && !map && (
        <EmptyState
          icon="layers"
          title="No topic map yet"
          hint="Build one to see which pillar pages to create and which clusters should support each of them."
        />
      )}

      {!loading && map && (
        <>
          <p className="px-1 text-xs leading-relaxed text-muted">{map.summary}</p>

          <div className="space-y-3">
            {map.pillars.map((pillar, i) => (
              <div key={pillar.targetKeyword + i} className="rounded-xl border border-line bg-surface">
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft/15 text-[11px] font-bold text-brand-soft">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{pillar.title}</div>
                    <div className="mt-0.5 truncate text-[11px] text-subtle">
                      target: {pillar.targetKeyword}
                    </div>
                  </div>
                  <IntentBadge intent={pillar.intent} />
                  <Pill tone="brand">{formatCompact(pillar.totalVolume)}/mo</Pill>
                  <Pill>{pillar.supporting.length} supporting</Pill>
                </div>

                {pillar.supporting.length > 0 ? (
                  <div className="px-4 py-1">
                    {pillar.supporting.map((s) => (
                      <div
                        key={s.clusterId}
                        className="flex items-center gap-3 border-b border-line/40 py-2 text-xs last:border-0"
                      >
                        {/* Visual "links up to the pillar" cue. */}
                        <span className="ml-3 flex items-center gap-2 text-subtle">
                          <span className="h-px w-4 bg-line-strong" />
                          <Icon name="chevronRight" size={11} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted">{s.title}</span>
                        <IntentBadge intent={s.intent} />
                        <span className="nums w-16 text-right text-subtle">
                          {formatCompact(s.volume)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-3 text-[11px] text-subtle">
                    Standalone pillar — no supporting clusters matched.
                  </p>
                )}
              </div>
            ))}
          </div>

          {map.orphans.length > 0 && (
            <div className="rounded-xl border border-dashed border-line bg-surface/50 px-4 py-3">
              <h3 className="text-xs font-semibold text-ink">
                Unassigned ({map.orphans.length})
              </h3>
              <p className="mt-0.5 text-[11px] text-muted">
                These clusters did not fit under a pillar. Left unassigned on purpose — a
                wrong parent produces internal links that muddy topical signals.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {map.orphans.map((o) => (
                  <Pill key={o.clusterId}>
                    {o.title} · {formatCompact(o.volume)}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
