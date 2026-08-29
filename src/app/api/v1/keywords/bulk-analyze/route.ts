import { z } from "zod";
import { handleError, ok, parseBody } from "@/lib/api";
import { enqueueJob } from "@/lib/jobs/runner";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";
import { estimateBulkEnrichCost } from "@/lib/providers/costs";
import { assertWithinQuota } from "@/lib/quota/service";

/**
 * Hard ceiling per request. PRD §12 targets 1M keywords; that scale arrives by
 * chunking the upload client-side into several jobs rather than posting a
 * 40MB JSON body, which would blow the request size limit long before the
 * pipeline struggled.
 */
const MAX_KEYWORDS_PER_REQUEST = 50_000;

const schema = z.object({
  projectId: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(MAX_KEYWORDS_PER_REQUEST),
});

/**
 * POST /api/v1/keywords/bulk-analyze
 * Always async — returns a job id to poll (PRD §11, §12).
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, schema);
    const project = await assertProjectAccess(agencyId, body.projectId);

    const keywords = [...new Set(body.keywords.map((k) => k.trim()).filter(Boolean))];
    if (keywords.length === 0) {
      return ok({ error: "No usable keywords in the upload" }, 422);
    }

    /**
     * Quota gate BEFORE the job is queued, so a refusal costs nothing.
     *
     * Checking here rather than inside the job handler matters: enqueueing
     * first would return 202, show a progress bar, and only then fail — after
     * the first batch had already been paid for.
     */
    const estimate = estimateBulkEnrichCost(keywords.length);
    await assertWithinQuota({ agencyId, estimate });

    const job = await enqueueJob({
      agencyId,
      projectId: project.id,
      type: "bulk_enrich",
      total: keywords.length,
      params: {
        keywords,
        language: project.language,
        location: project.location,
      },
    });

    return ok({ jobId: job.id, status: job.status, total: keywords.length }, 202);
  } catch (error) {
    return handleError(error);
  }
}
