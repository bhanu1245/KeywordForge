/**
 * Background job runner (PRD §12: "bulk jobs up to 1M keywords ... must be a
 * background job with progress polling, not a synchronous request").
 *
 * SCOPE OF THIS IMPLEMENTATION — read before deploying:
 * This is an in-process runner backed by the `jobs` table. Work starts on the
 * Node process that accepted the request and progress is written to the
 * database, so the UI polls the DB and not the worker. That is genuinely
 * sufficient for a single-instance MVP and it keeps the local stack at zero
 * infrastructure (no Redis on this machine — see README).
 *
 * What it does NOT survive: a process restart mid-job. Such jobs are left
 * `running` forever, so `reapStalledJobs` marks them failed on boot.
 *
 * The production swap is deliberately small: `JOB_HANDLERS` is a plain
 * dispatch table, so moving to BullMQ/Redis (or Laravel Horizon, had we gone
 * that way) means replacing `enqueueJob` with a queue publish and running the
 * same handlers in a worker process. Nothing above this file changes.
 */

import { prisma } from "../db";
import { enrichKeywordList, discoverKeywords, getProjectKeywords } from "../keywords/service";
import { generateClustersForProject, getProjectClusters } from "../clusters/service";
import { analyzeSerps } from "../serp/service";
import { writeCsvExport, writeXlsxExport } from "../export";

export type JobType =
  | "bulk_enrich"
  | "discover"
  | "cluster"
  | "export"
  | "serp_analyze";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobContext {
  jobId: string;
  agencyId: string;
  projectId: string | null;
  params: Record<string, unknown>;
  /** Writes progress to the DB; the UI polls for it. */
  setProgress: (done: number, total: number) => Promise<void>;
}

type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handleBulkEnrich: JobHandler = async (ctx) => {
  const keywords = (ctx.params.keywords as string[]) ?? [];
  const language = (ctx.params.language as string) ?? "en";
  const location = (ctx.params.location as string) ?? "United States";
  if (!ctx.projectId) throw new Error("bulk_enrich requires a projectId");

  const summary = await enrichKeywordList({
    projectId: ctx.projectId,
    agencyId: ctx.agencyId,
    keywords,
    language,
    location,
    onProgress: (done, total) => ctx.setProgress(done, total),
  });

  return { ...summary };
};

const handleDiscover: JobHandler = async (ctx) => {
  if (!ctx.projectId) throw new Error("discover requires a projectId");
  const summary = await discoverKeywords({
    projectId: ctx.projectId,
    agencyId: ctx.agencyId,
    seed: (ctx.params.seed as string) ?? "",
    limit: (ctx.params.limit as number) ?? 200,
    language: (ctx.params.language as string) ?? "en",
    location: (ctx.params.location as string) ?? "United States",
  });
  await ctx.setProgress(summary.received, summary.received);
  return { ...summary };
};

const handleCluster: JobHandler = async (ctx) => {
  if (!ctx.projectId) throw new Error("cluster requires a projectId");
  const result = await generateClustersForProject({
    projectId: ctx.projectId,
    threshold: ctx.params.threshold as number | undefined,
    minClusterSize: ctx.params.minClusterSize as number | undefined,
  });
  await ctx.setProgress(result.keywordsClustered, result.keywordsClustered);
  return { ...result };
};

const handleExport: JobHandler = async (ctx) => {
  if (!ctx.projectId) throw new Error("export requires a projectId");
  const format = ((ctx.params.format as string) ?? "csv").toLowerCase();
  const rows = await getProjectKeywords(
    ctx.projectId,
    (ctx.params.filters as Record<string, never>) ?? {},
  );

  // Attach cluster names so the export matches what the user sees on screen.
  const clusterNames = new Map<string, string>();
  const clusters = await getProjectClusters(ctx.projectId);
  for (const cluster of clusters) {
    for (const kw of cluster.keywords) clusterNames.set(kw.id, cluster.name);
  }

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    include: { client: true },
  });

  const exportRow = await prisma.export.create({
    data: {
      projectId: ctx.projectId,
      format: format === "xlsx" ? "xlsx" : "csv",
      status: "running",
      rowCount: rows.length,
    },
  });

  await ctx.setProgress(0, rows.length);

  const fileName = `${exportRow.id}.${format === "xlsx" ? "xlsx" : "csv"}`;
  const filePath =
    format === "xlsx"
      ? await writeXlsxExport(fileName, rows, clusterNames, {
          projectName: project?.name,
          clientName: project?.client.name,
        })
      : await writeCsvExport(fileName, rows, clusterNames);

  await prisma.export.update({
    where: { id: exportRow.id },
    data: { status: "completed", filePath },
  });
  await ctx.setProgress(rows.length, rows.length);

  return { exportId: exportRow.id, rowCount: rows.length, format };
};

/**
 * SERP analysis is one paid call per keyword (PRD §6), which is why it is a
 * job with visible progress rather than something discovery does implicitly.
 */
const handleSerpAnalyze: JobHandler = async (ctx) => {
  if (!ctx.projectId) throw new Error("serp_analyze requires a projectId");
  const result = await analyzeSerps({
    projectId: ctx.projectId,
    agencyId: ctx.agencyId,
    keywordIds: ctx.params.keywordIds as string[] | undefined,
    limit: (ctx.params.limit as number) ?? 25,
    language: (ctx.params.language as string) ?? "en",
    location: (ctx.params.location as string) ?? "United States",
    ownDomain: (ctx.params.ownDomain as string | null) ?? null,
    onProgress: (done, total) => ctx.setProgress(done, total),
  });
  return { ...result };
};

const JOB_HANDLERS: Record<JobType, JobHandler> = {
  bulk_enrich: handleBulkEnrich,
  discover: handleDiscover,
  cluster: handleCluster,
  export: handleExport,
  serp_analyze: handleSerpAnalyze,
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  agencyId: string;
  projectId?: string | null;
  type: JobType;
  params?: Record<string, unknown>;
  total?: number;
}

export async function enqueueJob(input: EnqueueInput) {
  const job = await prisma.job.create({
    data: {
      agencyId: input.agencyId,
      projectId: input.projectId ?? null,
      type: input.type,
      status: "queued",
      total: input.total ?? 0,
      params: input.params ? JSON.stringify(input.params) : null,
    },
  });

  // Fire-and-forget: the HTTP handler returns the job id immediately and the
  // client polls GET /api/v1/jobs/{id}. Errors are captured onto the job row,
  // never thrown into a floating promise.
  void runJob(job.id).catch((error) => {
    console.error(`[jobs] ${job.id} crashed outside its handler:`, error);
  });

  return job;
}

export async function runJob(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "queued") return;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date() },
  });

  const params = job.params
    ? (JSON.parse(job.params) as Record<string, unknown>)
    : {};

  const ctx: JobContext = {
    jobId,
    agencyId: job.agencyId,
    projectId: job.projectId,
    params,
    setProgress: async (done, total) => {
      await prisma.job
        .update({ where: { id: jobId }, data: { progress: done, total } })
        .catch(() => null);
    },
  };

  try {
    const handler = JOB_HANDLERS[job.type as JobType];
    if (!handler) throw new Error(`Unknown job type: ${job.type}`);
    const result = await handler(ctx);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "completed",
        finishedAt: new Date(),
        result: JSON.stringify(result),
      },
    });
  } catch (error) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/**
 * Any job still marked `running` at boot belongs to a process that no longer
 * exists. Left alone it would spin a progress bar forever, so it is failed
 * with an explicit reason the user can act on.
 */
export async function reapStalledJobs(): Promise<number> {
  const { count } = await prisma.job.updateMany({
    where: { status: { in: ["running", "queued"] } },
    data: {
      status: "failed",
      error: "Interrupted by a server restart. Re-run the job.",
      finishedAt: new Date(),
    },
  });
  return count;
}
