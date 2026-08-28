import { z } from "zod";
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { discoverKeywords, getProjectKeywords } from "@/lib/keywords/service";
import { normalizeText } from "@/lib/seo/normalize";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";
import { enqueueJob } from "@/lib/jobs/runner";

const schema = z.object({
  projectId: z.string().min(1),
  seed: z.string().min(1).max(200),
  // 1000 is the practical per-call ceiling on the DataForSEO ideas endpoint.
  limit: z.number().int().min(1).max(1000).optional(),
  /**
   * Large discoveries run as a job so the request returns immediately
   * (PRD §12). Small ones run inline — a spinner beats a job-polling round
   * trip for 200 rows.
   */
  async: z.boolean().optional(),
});

/** POST /api/v1/keywords/discover — seed keyword -> scored keyword ideas. */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, schema);
    const project = await assertProjectAccess(agencyId, body.projectId);

    // A seed of only punctuation or emoji normalises to nothing. Say so,
    // rather than reporting a successful run that added zero keywords.
    if (normalizeText(body.seed).length === 0) {
      return fail(
        "That seed has no searchable characters — try a word or phrase.",
        422,
      );
    }

    const limit = body.limit ?? 200;
    const params = {
      seed: body.seed,
      limit,
      language: project.language,
      location: project.location,
    };

    if (body.async || limit > 500) {
      const job = await enqueueJob({
        agencyId,
        projectId: project.id,
        type: "discover",
        params,
        total: limit,
      });
      return ok({ jobId: job.id, status: job.status }, 202);
    }

    const summary = await discoverKeywords({
      projectId: project.id,
      agencyId,
      ...params,
    });
    const keywords = await getProjectKeywords(project.id, { seed: summary.seed });

    return ok({ ...summary, keywords });
  } catch (error) {
    return handleError(error);
  }
}
