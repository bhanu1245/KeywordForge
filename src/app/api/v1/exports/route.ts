import { z } from "zod";
import { handleError, ok, parseBody } from "@/lib/api";
import { enqueueJob } from "@/lib/jobs/runner";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const schema = z.object({
  projectId: z.string().min(1),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  /** Same filter shape as GET /keywords, so exports match what's on screen. */
  filters: z
    .object({
      search: z.string().optional(),
      minVolume: z.number().int().min(0).optional(),
      maxVolume: z.number().int().min(0).optional(),
      minDifficulty: z.number().int().min(0).max(100).optional(),
      maxDifficulty: z.number().int().min(0).max(100).optional(),
      minWords: z.number().int().min(1).optional(),
      questionsOnly: z.boolean().optional(),
      intents: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * POST /api/v1/exports — always a background job.
 *
 * PRD §12: "PDF/Excel export of large keyword sets must be a background job,
 * not synchronous." Small exports go through the same path rather than a
 * special case, so there is one code path to keep correct.
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, schema);
    const project = await assertProjectAccess(agencyId, body.projectId);

    const job = await enqueueJob({
      agencyId,
      projectId: project.id,
      type: "export",
      params: { format: body.format, filters: body.filters ?? {} },
    });

    return ok({ jobId: job.id, status: job.status }, 202);
  } catch (error) {
    return handleError(error);
  }
}
