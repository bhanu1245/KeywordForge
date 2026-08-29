"use client";

import { useMemo, useState } from "react";
import type { ClusterView, KeywordRow, ProjectAssumptions } from "@/lib/types";
import { Icon } from "./Icon";
import { Button, EmptyState, IntentBadge, Pill, formatCompact, formatNumber } from "./ui";

/**
 * Revenue Potential (PRD §7 module 33).
 *
 * PRESENTATION RULE, same as Difficulty in Phase 1: this is a modelled
 * estimate and must never look measured. The assumptions banner is rendered
 * above every figure, not tucked into a settings screen — and until the user
 * supplies real numbers the panel shows a prompt rather than revenue computed
 * from placeholder defaults.
 */

const money = (n: number) =>
  n >= 10_000
    ? `$${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)}`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function RevenuePanel({
  projectId,
  keywords,
  clusters,
  assumptions,
  onSaved,
}: {
  projectId: string;
  keywords: KeywordRow[];
  clusters: ClusterView[];
  assumptions: ProjectAssumptions;
  onSaved: () => void;
}) {
  const [rate, setRate] = useState(
    assumptions.conversionRate !== null ? String(assumptions.conversionRate * 100) : "2",
  );
  const [value, setValue] = useState(
    assumptions.orderValue !== null ? String(assumptions.orderValue) : "",
  );
  const [position, setPosition] = useState(String(assumptions.position));
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"keywords" | "clusters">("keywords");

  const ranked = useMemo(
    () => [...keywords].sort((a, b) => b.revenuePotential - a.revenuePotential),
    [keywords],
  );

  /** Cluster revenue is the sum of its members — no separate model. */
  const clusterRevenue = useMemo(() => {
    const byId = new Map(keywords.map((k) => [k.projectKeywordId, k]));
    return clusters
      .map((c) => ({
        ...c,
        revenue: c.keywords.reduce(
          (n, k) => n + (byId.get(k.id)?.revenuePotential ?? 0),
          0,
        ),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [clusters, keywords]);

  const total = ranked.reduce((n, k) => n + k.revenuePotential, 0);

  async function save() {
    setBusy(true);
    try {
      await fetch("/api/v1/projects/assumptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          conversionRatePercent: rate === "" ? null : Number(rate),
          orderValue: value === "" ? null : Number(value),
          position: Number(position),
        }),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const FIELD =
    "nums h-8 w-24 rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-brand-soft";

  return (
    <div className="space-y-4">
      {/* Assumptions are the headline, not a footnote. */}
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="space-y-1">
            <label htmlFor="rev-cr" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
              Conversion rate
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="rev-cr"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className={FIELD}
              />
              <span className="text-xs text-subtle">%</span>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="rev-aov" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
              Average order value
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-subtle">$</span>
              <input
                id="rev-aov"
                type="number"
                min={0}
                step={1}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="—"
                className={FIELD}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="rev-pos" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
              Target position
            </label>
            <input
              id="rev-pos"
              type="number"
              min={1}
              max={20}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className={FIELD}
            />
          </div>

          <Button onClick={save} loading={busy} icon="check">
            Save assumptions
          </Button>

          {assumptions.configured && (
            <div className="ml-auto text-right">
              <div className="text-[10px] uppercase tracking-wider text-subtle">
                Modelled monthly revenue
              </div>
              <div className="nums text-xl font-semibold text-brand-soft">{money(total)}</div>
            </div>
          )}
        </div>

        <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-2.5 text-[11px] leading-relaxed text-muted">
          <Icon name="help" size={12} className="mt-0.5 shrink-0" />
          <span>
            <strong className="text-ink">This is a modelled estimate, not a measurement.</strong>{" "}
            {assumptions.description} Volume is a provider&apos;s modelled figure, the CTR comes
            from a generic industry curve that ignores SERP features and brand pull, and the
            conversion rate and order value are your inputs — the model cannot check any of them.
            Useful for ranking opportunities against each other and sizing a bet; not a forecast.
          </span>
        </p>
      </div>

      {!assumptions.configured ? (
        <EmptyState
          icon="target"
          title="Set your assumptions to model revenue"
          hint="Enter a conversion rate and average order value above. Until then nothing is shown — a revenue figure built on numbers you did not choose would be worse than no figure at all."
        />
      ) : (
        <>
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface px-4 py-3">
            {(
              [
                ["keywords", `Keywords (${formatNumber(ranked.length)})`],
                ["clusters", `Clusters (${clusterRevenue.length})`],
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

          {view === "keywords" ? (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div
                className="grid items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle"
                style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 90px 104px 110px" }}
              >
                <span>Keyword</span>
                <span className="text-right">Volume</span>
                <span className="text-right">Sessions</span>
                <span>Intent</span>
                <span className="text-right">Est. revenue/mo</span>
              </div>
              <div className="max-h-[520px] overflow-auto">
                {ranked.slice(0, 500).map((k) => (
                  <div
                    key={k.projectKeywordId}
                    className="grid items-center gap-3 border-b border-line/50 px-4 py-2.5 text-xs"
                    style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 90px 104px 110px" }}
                  >
                    <span className="truncate text-ink" title={k.text}>{k.text}</span>
                    <span className="nums text-right text-muted">{formatNumber(k.volume)}</span>
                    <span className="nums text-right text-muted">
                      {formatNumber(k.trafficPotential)}
                    </span>
                    <span><IntentBadge intent={k.intent} /></span>
                    <span className="nums text-right font-medium text-brand-soft">
                      {money(k.revenuePotential)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {clusterRevenue.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {c.name}
                  </span>
                  <IntentBadge intent={c.intent} />
                  <Pill>{formatNumber(c.keywordCount)} kw</Pill>
                  <span className="nums text-xs text-muted">
                    {formatCompact(c.totalVolume)}/mo
                  </span>
                  <span className="nums w-24 text-right text-sm font-semibold text-brand-soft">
                    {money(c.revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
