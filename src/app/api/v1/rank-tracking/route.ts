import { z } from "zod";
import { fail, handleError, ok, parseBody, parseQuery } from "@/lib/api";
import { enqueueJob } from "@/lib/jobs/runner";
import { getCannibalisation, getRankHistory, getRankSummary } from "@/lib/rank/service";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";
import { estimateRankCheckCost } from "@/lib/providers/costs";
import { assertWithinQuota } from "@/lib/quota/service";

const getSchema = z.object({
  projectId: z.string().min(1),
  /** Supply to fetch one keyword's position history instead of the summary. */
  keywordId: z.string().min(1).optional(),
  view: z.enum(["summary", "cannibalisation"]).optional(),
});

const postSchema = z.object({
  projectId: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * GET /api/v1/rank-tracking (PRD §11 `GET /rank-tracking/{project_id}`)
 *   ?view=summary          current positions + movement
 *   ?view=cannibalisation  our own pages competing with each other
 *   ?keywordId=            position history for one keyword
 */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const query = parseQuery(request, getSchema);
    const project = await assertProjectAccess(agencyId, query.projectId);
    const ownDomain = project.domain ?? project.client.domain ?? null;

    if (query.keywordId) {
      return ok({ history: await getRankHistory(project.id, query.keywordId) });
    }
    if (query.view === "cannibalisation") {
      return ok({ ownDomain, rows: await getCannibalisation(project.id, ownDomain) });
    }
    return ok({ ownDomain, ...(await getRankSummary(project.id, ownDomain)) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/v1/rank-tracking — run a rank check now.
 *
 * PRD §5 sets the cadence as daily, not hourly. There is no scheduler in this
 * build (see README on the in-process job runner), so a check is triggered
 * explicitly or by an external cron calling this endpoint.
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, postSchema);
    const project = await assertProjectAccess(agencyId, body.projectId);
    const ownDomain = project.domain ?? project.client.domain ?? null;

    // Rank tracking is meaningless without knowing which domain is "us".
    if (!ownDomain) {
      return fail(
        "Set a domain on this project (or its client) before tracking rankings.",
        422,
      );
    }

    // Rank checks bypass the SERP cache by design, so every keyword is a
    // fresh billable call — no cache relief to discount for.
    const keywordCount = body.limit ?? 25;
    await assertWithinQuota({ agencyId, estimate: estimateRankCheckCost(keywordCount) });

    const job = await enqueueJob({
      agencyId,
      projectId: project.id,
      type: "rank_check",
      total: keywordCount,
      params: {
        limit: body.limit ?? 25,
        language: project.language,
        location: project.location,
        ownDomain,
      },
    });

    return ok({ jobId: job.id, status: job.status }, 202);
  } catch (error) {
    return handleError(error);
  }
}
