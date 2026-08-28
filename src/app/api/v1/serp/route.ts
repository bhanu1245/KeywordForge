import { z } from "zod";
import { handleError, ok, parseBody, parseQuery } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/runner";
import { getSerpCoverage, getSerpForKeyword } from "@/lib/serp/service";
import { assertProjectAccess, resolveContext, TenantAccessError } from "@/lib/tenancy";

const getSchema = z.object({
  projectId: z.string().min(1),
  /** Supply to fetch one keyword's full SERP instead of the project summary. */
  keywordId: z.string().min(1).optional(),
});

const postSchema = z.object({
  projectId: z.string().min(1),
  keywordIds: z.array(z.string().min(1)).max(500).optional(),
  // SERP calls are the expensive ones (PRD §6), so the batch is capped and
  // must be asked for explicitly rather than defaulting high.
  limit: z.number().int().min(1).max(200).optional(),
});

/** GET /api/v1/serp — project SERP-feature coverage, or one keyword's SERP. */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const query = parseQuery(request, getSchema);
    const project = await assertProjectAccess(agencyId, query.projectId);

    if (query.keywordId) {
      // The keyword corpus is shared across tenants, so owning the project is
      // not enough — this keyword must actually be linked to THIS project
      // before its SERP is returned.
      const link = await prisma.projectKeyword.findFirst({
        where: { projectId: project.id, keywordId: query.keywordId },
        select: { id: true },
      });
      if (!link) throw new TenantAccessError();
      return ok({ serp: await getSerpForKeyword(query.keywordId) });
    }

    return ok(await getSerpCoverage(project.id));
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/v1/serp — run SERP analysis as a background job.
 * Always async: one call per keyword, so even 50 keywords is far too slow for
 * a request cycle.
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, postSchema);
    const project = await assertProjectAccess(agencyId, body.projectId);

    const job = await enqueueJob({
      agencyId,
      projectId: project.id,
      type: "serp_analyze",
      total: body.keywordIds?.length ?? body.limit ?? 25,
      params: {
        keywordIds: body.keywordIds,
        limit: body.limit ?? 25,
        language: project.language,
        location: project.location,
        ownDomain: project.domain ?? project.client.domain ?? null,
      },
    });

    return ok({ jobId: job.id, status: job.status }, 202);
  } catch (error) {
    return handleError(error);
  }
}
