"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeywordRow } from "@/lib/types";
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
 * Google Maps / YouTube / Amazon keywords and the Local SEO view
 * (PRD §7 modules 22-25).
 *
 * Grouped as "Channels" because they answer one question — where else is there
 * demand for this business? Each surface is a separate corpus with its own
 * volume and CPC, never a filter over Google data, so the panel makes you pick
 * a channel and discover into it explicitly.
 */

const CHANNELS = [
  { id: "google_maps", label: "Google Maps", icon: "target" as const, note: "Local pack and map demand" },
  { id: "youtube", label: "YouTube", icon: "search" as const, note: "Video and how-to demand" },
  { id: "amazon", label: "Amazon", icon: "table" as const, note: "Marketplace buying demand" },
];

interface LocalSummary {
  localKeywords: number;
  withLocalPack: number;
  analyzed: number;
  packShare: number;
  topLocalCompetitors: Array<{ domain: string; appearances: number }>;
  rows: Array<{
    keywordId: string;
    text: string;
    volume: number | null;
    difficulty: number | null;
    hasLocalPack: boolean;
    localIntent: boolean;
    ownPosition: number | null;
  }>;
}

export function ChannelPanel({ projectId }: { projectId: string }) {
  const [channel, setChannel] = useState<string>("google_maps");
  const [seed, setSeed] = useState("");
  const [rows, setRows] = useState<KeywordRow[]>([]);
  const [local, setLocal] = useState<LocalSummary | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChannel = useCallback(
    async (ch: string) => {
      const res = await fetch(`/api/v1/keywords?projectId=${projectId}&channel=${ch}`);
      if (res.ok) setRows((await res.json()).keywords as KeywordRow[]);
    },
    [projectId],
  );

  useEffect(() => {
    void loadChannel(channel);
  }, [channel, loadChannel]);

  useEffect(() => {
    if (!showLocal) return;
    fetch(`/api/v1/local?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => json && setLocal(json as LocalSummary))
      .catch(() => {});
  }, [showLocal, projectId]);

  async function discover() {
    if (!seed.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/keywords/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, seed, limit: 200, channel }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Discovery failed.");
        return;
      }
      await loadChannel(channel);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const active = CHANNELS.find((c) => c.id === channel);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-1">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setChannel(c.id);
                setShowLocal(false);
              }}
              title={c.note}
              className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                channel === c.id && !showLocal
                  ? "border-brand-soft/50 bg-brand-soft/15 text-brand-soft"
                  : "border-line text-subtle hover:text-muted"
              }`}
            >
              <Icon name={c.icon} size={12} />
              {c.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowLocal(true)}
            title="Local pack presence across your Google keywords"
            className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              showLocal
                ? "border-brand-soft/50 bg-brand-soft/15 text-brand-soft"
                : "border-line text-subtle hover:text-muted"
            }`}
          >
            <Icon name="target" size={12} />
            Local SEO
          </button>
        </div>

        {!showLocal && (
          <div className="ml-auto flex items-center gap-2">
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && discover()}
              placeholder={`Seed for ${active?.label}…`}
              aria-label={`Seed keyword for ${active?.label}`}
              className="h-8 w-56 rounded-lg border border-line bg-canvas px-3 text-xs text-ink outline-none placeholder:text-subtle focus:border-brand-soft"
            />
            <Button onClick={discover} loading={busy} disabled={!seed.trim()} icon="search">
              Discover
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
          <Icon name="alert" size={14} />
          {error}
        </div>
      )}

      {showLocal ? (
        !local || local.localKeywords === 0 ? (
          <EmptyState
            icon="target"
            title="No local signals found yet"
            hint="Local SEO reads the SERPs you have already analysed, looking for local packs and 'near me' style queries. Run a SERP analysis first."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                ["Local keywords", formatNumber(local.localKeywords)],
                ["With local pack", formatNumber(local.withLocalPack)],
                ["Pack share", `${local.packShare}%`],
                ["Analysed", formatNumber(local.analyzed)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
                  <div className="nums mt-0.5 text-lg font-semibold text-ink">{value}</div>
                </div>
              ))}
            </div>

            {local.topLocalCompetitors.length > 0 && (
              <div className="rounded-xl border border-line bg-surface p-4">
                <h3 className="text-xs font-semibold text-ink">Local competitors</h3>
                <p className="mt-0.5 text-[11px] text-muted">
                  Domains in the top 5 on your local queries — often a different set from your national rivals.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {local.topLocalCompetitors.map((c) => (
                    <Pill key={c.domain}>{c.domain} · {c.appearances}</Pill>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div
                className="grid items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle"
                style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 104px 90px 80px" }}
              >
                <span>Keyword</span>
                <span className="text-right">Volume</span>
                <span>KD</span>
                <span className="text-right">Local pack</span>
                <span className="text-right">You</span>
              </div>
              <div className="max-h-[460px] overflow-auto">
                {local.rows.map((r) => (
                  <div
                    key={r.keywordId}
                    className="grid items-center gap-3 border-b border-line/50 px-4 py-2.5 text-xs"
                    style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 104px 90px 80px" }}
                  >
                    <span className="truncate text-ink">{r.text}</span>
                    <span className="nums text-right text-muted">{formatNumber(r.volume)}</span>
                    <span>{r.difficulty !== null ? <DifficultyCell value={r.difficulty} /> : "—"}</span>
                    <span className="text-right">
                      {r.hasLocalPack ? <Pill tone="brand">pack</Pill> : <span className="text-subtle">—</span>}
                    </span>
                    <span className="nums text-right text-muted">
                      {r.ownPosition ? `#${r.ownPosition}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon="search"
          title={`No ${active?.label} keywords yet`}
          hint={`${active?.note}. Enter a seed above — this discovers a separate corpus with its own volume and CPC, not a filter over your Google keywords.`}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center gap-3 border-b border-line bg-elevated/60 px-4 py-2.5">
            <span className="text-xs font-semibold text-ink">{active?.label}</span>
            <Pill>{formatNumber(rows.length)} keywords</Pill>
            <Pill tone="brand">
              {formatCompact(rows.reduce((n, r) => n + (r.volume ?? 0), 0))}/mo
            </Pill>
          </div>
          <div
            className="grid items-center gap-3 border-b border-line bg-elevated/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-subtle"
            style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 104px 104px 76px" }}
          >
            <span>Keyword</span>
            <span className="text-right">Volume</span>
            <span>KD</span>
            <span>Intent</span>
            <span className="text-right">CPC</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            {rows.map((r) => (
              <div
                key={r.projectKeywordId}
                className="grid items-center gap-3 border-b border-line/50 px-4 py-2.5 text-xs"
                style={{ gridTemplateColumns: "minmax(200px,1fr) 80px 104px 104px 76px" }}
              >
                <span className="truncate text-ink" title={r.text}>{r.text}</span>
                <span className="nums text-right text-muted">{formatNumber(r.volume)}</span>
                <DifficultyCell value={r.difficulty} />
                <span><IntentBadge intent={r.intent} /></span>
                <span className="nums text-right text-muted">
                  {r.cpc === null ? "—" : `$${r.cpc.toFixed(2)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
