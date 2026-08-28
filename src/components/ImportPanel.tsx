"use client";

import { useRef, useState } from "react";
import type { JobView } from "@/lib/types";
import { Icon } from "./Icon";
import { Button, formatNumber } from "./ui";

/**
 * Bulk CSV import (PRD §8 flow 4).
 *
 * Parsing happens in the browser so a 50MB CSV never crosses the wire — only
 * the extracted keyword strings do. The progress bar reflects a real job being
 * polled, not a decorative animation.
 */
export function ImportPanel({
  projectId,
  onComplete,
}: {
  projectId: string;
  onComplete: () => void;
}) {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Takes the first column of each line, skipping a header row when the first
   * cell looks like a column name. Handles quoted cells so "rings, gold" stays
   * a single keyword.
   */
  function parseCsv(text: string): string[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const firstCell = (line: string): string => {
      if (!line.startsWith('"')) return line.split(",")[0].trim();
      const end = line.indexOf('"', 1);
      return end === -1 ? line.slice(1).trim() : line.slice(1, end).trim();
    };

    const cells = lines.map(firstCell);
    const header = cells[0]?.toLowerCase();
    const looksLikeHeader =
      header === "keyword" || header === "keywords" || header === "term" || header === "query";

    return [...new Set((looksLikeHeader ? cells.slice(1) : cells).filter(Boolean))];
  }

  async function onFile(file: File) {
    setError(null);
    setFileName(file.name);
    const parsed = parseCsv(await file.text());
    setKeywords(parsed);
    if (parsed.length === 0) setError("No keywords found in that file.");
  }

  function usePasted() {
    const parsed = [...new Set(pasted.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
    if (parsed.length === 0) return;
    setKeywords(parsed);
    setFileName(`${parsed.length} pasted keywords`);
    setError(null);
  }

  async function start() {
    setError(null);
    try {
      const res = await fetch("/api/v1/keywords/bulk-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, keywords }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Import failed to start.");
        return;
      }
      void poll(json.jobId as string);
    } catch {
      setError("Could not reach the server.");
    }
  }

  /** 700ms: fast enough that the bar visibly moves, slow enough not to hammer. */
  async function poll(jobId: string) {
    for (;;) {
      const res = await fetch(`/api/v1/jobs/${jobId}`);
      if (!res.ok) {
        setError("Lost track of the import job.");
        return;
      }
      const next = (await res.json()) as JobView;
      setJob(next);

      if (next.status === "completed") {
        onComplete();
        return;
      }
      if (next.status === "failed") {
        setError(next.error ?? "Import failed.");
        return;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  const running = job?.status === "queued" || job?.status === "running";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Bulk import</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Upload a CSV (first column = keyword) or paste one per line. Rows are
          enriched with volume, CPC, difficulty and intent in the background.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void onFile(file);
          }}
          className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-brand-soft bg-brand-soft/5" : "border-line hover:border-line-strong"
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <div className="grid size-9 place-items-center justify-self-center rounded-full border border-line bg-elevated text-subtle">
            <Icon name="upload" size={16} />
          </div>
          <p className="mt-3 text-xs text-muted">
            Drag a CSV here, or{" "}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded font-medium text-brand-soft underline-offset-2 hover:underline"
            >
              browse
            </button>
          </p>
          {fileName && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1 text-[11px] text-muted">
              <Icon name="check" size={11} className="text-easy" />
              {fileName} · <span className="nums text-ink">{formatNumber(keywords.length)}</span> keywords
            </p>
          )}
        </div>

        <div className="mt-4 space-y-1">
          <label htmlFor="kf-paste" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Or paste keywords
          </label>
          <textarea
            id="kf-paste"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            onBlur={usePasted}
            rows={5}
            placeholder={"gold rings\nsilver necklace\nengagement ring uk"}
            className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft"
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            size="md"
            onClick={start}
            disabled={keywords.length === 0}
            loading={running}
            icon="sparkles"
          >
            {running ? "Importing…" : `Enrich ${formatNumber(keywords.length)} keywords`}
          </Button>
          {error && (
            <span role="alert" className="inline-flex items-center gap-1.5 text-xs text-danger">
              <Icon name="alert" size={13} />
              {error}
            </span>
          )}
        </div>
      </div>

      {job && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium capitalize text-ink">
              {job.status === "completed" ? (
                <Icon name="check" size={13} className="text-easy" />
              ) : job.status === "failed" ? (
                <Icon name="alert" size={13} className="text-danger" />
              ) : (
                <Icon name="spinner" size={13} className="animate-spin text-brand-soft" />
              )}
              {job.status}
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
            aria-label="Import progress"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                job.status === "failed" ? "bg-danger" : "bg-brand-soft"
              }`}
              style={{ width: `${job.percent}%` }}
            />
          </div>
          {job.status === "completed" && (
            <p className="mt-2.5 text-xs text-easy">Done — keywords added to the project.</p>
          )}
        </div>
      )}
    </div>
  );
}
