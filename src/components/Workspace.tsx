"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  ClusterView,
  Intent,
  JobView,
  KeywordFilters,
  KeywordRow,
} from "@/lib/types";
import { isLongTail, isQuestion } from "@/lib/seo/questions";
import { normalizeText } from "@/lib/seo/normalize";
import type { SerpCoverageView } from "@/lib/types";
import { ClusterPanel } from "./ClusterPanel";
import { CompetitorPanel } from "./CompetitorPanel";
import { FilterBar } from "./FilterBar";
import { Icon } from "./Icon";
import { ImportPanel } from "./ImportPanel";
import { KeywordTable } from "./KeywordTable";
import { SeedGenerator } from "./SeedGenerator";
import { SerpPanel } from "./SerpPanel";
import { TopicMapPanel } from "./TopicMapPanel";
import { Button, EmptyState, Stat, formatCompact, formatCurrency, formatNumber } from "./ui";

type Tab = "explorer" | "clusters" | "serp" | "competitors" | "topicmap" | "import";

export interface WorkspaceProject {
  id: string;
  name: string;
  clientName: string;
  location: string;
  language: string;
}

/**
 * The project workspace: discovery, filtering, clustering and export in one
 * place (PRD §8). The full keyword set is fetched once and filtered in the
 * browser — that is what makes "time-to-first-insight under 30 seconds"
 * (PRD §13) achievable, since filtering thousands of rows costs no round trip.
 */
export function Workspace({
  project,
  initialKeywords,
  initialClusters,
  initialSerpCoverage,
  isLiveProvider,
}: {
  project: WorkspaceProject;
  initialKeywords: KeywordRow[];
  initialClusters: ClusterView[];
  initialSerpCoverage: SerpCoverageView | null;
  isLiveProvider: boolean;
}) {
  const [tab, setTab] = useState<Tab>("explorer");
  const [keywords, setKeywords] = useState<KeywordRow[]>(initialKeywords);
  const [clusters, setClusters] = useState<ClusterView[]>(initialClusters);
  const [serpCoverage, setSerpCoverage] = useState<SerpCoverageView | null>(initialSerpCoverage);
  const [filters, setFilters] = useState<KeywordFilters>({});
  const [seed, setSeed] = useState("");
  const [showGenerator, setShowGenerator] = useState(false);
  const [busy, setBusy] = useState<null | "discover" | "cluster" | "export">(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);

  const reload = useCallback(async () => {
    const [kwRes, clRes, serpRes] = await Promise.all([
      fetch(`/api/v1/keywords?projectId=${project.id}`),
      fetch(`/api/v1/clusters?projectId=${project.id}`),
      fetch(`/api/v1/serp?projectId=${project.id}`),
    ]);
    if (kwRes.ok) setKeywords((await kwRes.json()).keywords as KeywordRow[]);
    if (clRes.ok) setClusters((await clRes.json()).clusters as ClusterView[]);
    if (serpRes.ok) setSerpCoverage((await serpRes.json()) as SerpCoverageView);
  }, [project.id]);

  /** `override` lets the seed generator run discovery on a suggestion directly. */
  async function discover(override?: string) {
    const term = (override ?? seed).trim();
    if (!term) return;
    setBusy("discover");
    setNotice(null);
    if (override) setSeed(override);
    try {
      const res = await fetch("/api/v1/keywords/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, seed: term, limit: 300 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice({ text: json.error ?? "Discovery failed.", tone: "bad" });
        return;
      }
      await reload();
      setNotice({
        text: `Added ${json.linkedToProject} new keywords for “${json.seed}”.`,
        tone: "ok",
      });
      setTab("explorer");
    } catch {
      setNotice({ text: "Could not reach the server.", tone: "bad" });
    } finally {
      setBusy(null);
    }
  }

  async function regenerateClusters(threshold: number, minClusterSize: number) {
    setBusy("cluster");
    try {
      const res = await fetch("/api/v1/clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, threshold, minClusterSize }),
      });
      if (res.ok) setClusters((await res.json()).clusters as ClusterView[]);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Export runs as a job (PRD §12), so this polls and then navigates to the
   * download once the file exists — a plain navigation rather than fetch+blob
   * so the browser's own save dialog handles large files.
   */
  async function exportTo(format: "csv" | "xlsx") {
    setBusy("export");
    setNotice(null);
    try {
      const res = await fetch("/api/v1/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, format }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice({ text: json.error ?? "Export failed to start.", tone: "bad" });
        return;
      }

      for (;;) {
        const job = (await (await fetch(`/api/v1/jobs/${json.jobId}`)).json()) as JobView;
        if (job.status === "completed") {
          const exportId = (job.result as { exportId?: string })?.exportId;
          if (exportId) window.location.href = `/api/v1/exports/${exportId}/download`;
          return;
        }
        if (job.status === "failed") {
          setNotice({ text: job.error ?? "Export failed.", tone: "bad" });
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      setBusy(null);
    }
  }

  // Client-side filtering, mirroring the server filter semantics in
  // lib/keywords/service.ts so an export matches what is on screen.
  const filtered = useMemo(() => {
    const search = filters.search ? normalizeText(filters.search) : null;
    return keywords.filter((k) => {
      if (search && !k.text.includes(search)) return false;
      if (filters.minVolume !== undefined && (k.volume ?? 0) < filters.minVolume) return false;
      if (filters.maxVolume !== undefined && (k.volume ?? 0) > filters.maxVolume) return false;
      if (filters.maxDifficulty !== undefined && k.difficulty > filters.maxDifficulty) return false;
      if (filters.minDifficulty !== undefined && k.difficulty < filters.minDifficulty) return false;
      if (filters.intents?.length && !filters.intents.includes(k.intent as Intent)) return false;
      if (filters.questionsOnly && !isQuestion(k.text)) return false;
      if (filters.minWords && !isLongTail(k.text, filters.minWords)) return false;
      return true;
    });
  }, [keywords, filters]);

  const summary = useMemo(
    () => ({
      count: filtered.length,
      totalVolume: filtered.reduce((n, k) => n + (k.volume ?? 0), 0),
      avgDifficulty:
        filtered.length === 0
          ? 0
          : Math.round(filtered.reduce((n, k) => n + k.difficulty, 0) / filtered.length),
      totalValue: filtered.reduce((n, k) => n + k.commercialValue, 0),
      questions: filtered.filter((k) => k.isQuestion).length,
    }),
    [filtered],
  );

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const analyzedSerps = serpCoverage?.analyzed ?? 0;

  const TABS: Array<[Tab, string, "table" | "layers" | "upload" | "search" | "target", number | null]> = [
    ["explorer", "Explorer", "table", filtered.length],
    ["clusters", "Clusters", "layers", clusters.length],
    ["serp", "SERP", "search", analyzedSerps],
    ["competitors", "Competitors", "target", null],
    ["topicmap", "Topic map", "layers", null],
    ["import", "Import", "upload", null],
  ];

  const isEmpty = keywords.length === 0;

  return (
    <main className="mx-auto max-w-[1600px] px-5 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded text-xs text-subtle transition-colors hover:text-muted"
          >
            <Icon name="chevronRight" size={12} className="rotate-180" />
            {project.clientName}
          </Link>
          <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight text-ink">
            {project.name}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-subtle">
            <Icon name="target" size={11} />
            {project.location} · {project.language.toUpperCase()}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void discover();
              }}
              placeholder="Seed keyword, e.g. gold rings"
              aria-label="Seed keyword"
              className="h-9 w-72 rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft"
            />
          </div>
          <Button
            size="md"
            onClick={() => discover()}
            loading={busy === "discover"}
            disabled={!seed.trim()}
            icon="search"
          >
            Discover
          </Button>
          <Button
            size="md"
            variant="outline"
            icon="sparkles"
            onClick={() => setShowGenerator(true)}
            title="Generate seed keywords from a business description or URL"
          >
            Suggest seeds
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Keywords" value={formatNumber(summary.count)} icon="table" />
        <Stat label="Volume / mo" value={formatCompact(summary.totalVolume)} icon="arrowUp" />
        <Stat
          label="Avg. difficulty"
          value={summary.avgDifficulty}
          icon="target"
          hint="Proxy score from competition, volume and phrase length — not an Ahrefs KD."
        />
        <Stat
          label="Traffic value"
          value={formatCurrency(summary.totalValue)}
          icon="sparkles"
          accent
          hint="What this traffic would cost in Google Ads at position 3."
        />
        <Stat label="Questions" value={formatNumber(summary.questions)} icon="help" />
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map(([key, label, icon, count]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={active ? "page" : undefined}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors ${
                active
                  ? "border-brand-soft text-ink"
                  : "border-transparent text-subtle hover:text-muted"
              }`}
            >
              <Icon name={icon} size={13} />
              {label}
              {count !== null && (
                <span className={`nums rounded px-1.5 py-0.5 text-[10px] ${active ? "bg-brand-soft/15 text-brand-soft" : "bg-elevated text-subtle"}`}>
                  {formatNumber(count)}
                </span>
              )}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2 pb-2">
          <Button variant="outline" icon="download" onClick={() => exportTo("csv")} disabled={busy !== null || isEmpty}>
            CSV
          </Button>
          <Button variant="outline" icon="download" onClick={() => exportTo("xlsx")} disabled={busy !== null || isEmpty}>
            Excel
          </Button>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`mt-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
            notice.tone === "ok"
              ? "border-brand-soft/25 bg-brand-soft/10 text-brand-soft"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          <Icon name={notice.tone === "ok" ? "check" : "alert"} size={14} />
          {notice.text}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {tab === "explorer" &&
          (isEmpty ? (
            <EmptyState
              icon="search"
              title="No keywords yet"
              hint="Enter a seed keyword above and press Discover, or import an existing list from the Import tab."
              action={
                <Button onClick={() => setTab("import")} variant="outline" icon="upload">
                  Import a CSV
                </Button>
              }
            />
          ) : (
            <>
              <FilterBar
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters({})}
                resultCount={filtered.length}
              />
              <KeywordTable rows={filtered} />
            </>
          ))}

        {tab === "clusters" && (
          <ClusterPanel
            clusters={clusters}
            onRegenerate={regenerateClusters}
            busy={busy === "cluster"}
          />
        )}

        {tab === "serp" && (
          <SerpPanel
            projectId={project.id}
            coverage={serpCoverage}
            onRefresh={() => void reload()}
            isLiveProvider={isLiveProvider}
          />
        )}

        {tab === "competitors" && (
          <CompetitorPanel projectId={project.id} hasSerpData={analyzedSerps > 0} />
        )}

        {tab === "topicmap" && (
          <TopicMapPanel projectId={project.id} hasClusters={clusters.length > 0} />
        )}

        {tab === "import" && (
          <ImportPanel
            projectId={project.id}
            onComplete={() => {
              void reload();
              setTab("explorer");
            }}
          />
        )}
      </div>

      {showGenerator && (
        <SeedGenerator
          projectId={project.id}
          onClose={() => setShowGenerator(false)}
          onPick={(picked) => {
            setShowGenerator(false);
            void discover(picked);
          }}
        />
      )}
    </main>
  );
}
