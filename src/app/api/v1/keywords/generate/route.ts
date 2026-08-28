import { z } from "zod";
import { fail, handleError, ok, parseBody } from "@/lib/api";
import {
  UnsafeUrlError,
  generateSeedKeywords,
} from "@/lib/ai/keywordGenerator";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const schema = z
  .object({
    projectId: z.string().min(1),
    description: z.string().max(2000).optional(),
    url: z.string().max(2048).optional(),
  })
  .refine((v) => Boolean(v.description?.trim() || v.url?.trim()), {
    message: "Provide a business description, a URL, or both",
    path: ["description"],
  });

/**
 * POST /api/v1/keywords/generate — seed keywords from a business description
 * or website URL (PRD §7 module 17).
 *
 * Returns SUGGESTIONS only; it deliberately does not run discovery itself.
 * Each seed costs a metered provider call (PRD §6), so the user picks which
 * ones to expand rather than the app spending on twelve at once.
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, schema);
    await assertProjectAccess(agencyId, body.projectId);

    const result = await generateSeedKeywords({
      description: body.description?.trim(),
      url: body.url?.trim(),
    });

    return ok({
      seeds: result.seeds,
      source: result.source,
      context: result.context
        ? {
            url: result.context.url,
            title: result.context.title,
            description: result.context.description,
            headingCount: result.context.headings.length,
          }
        : null,
    });
  } catch (error) {
    // URL problems are the user's to fix (bad address, blocked host, timeout),
    // so they surface as a readable 400 rather than a 500.
    if (error instanceof UnsafeUrlError) return fail(error.message, error.status);
    return handleError(error);
  }
}
