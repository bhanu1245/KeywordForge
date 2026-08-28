import { z } from "zod";
import { handleError, ok, parseQuery } from "@/lib/api";
import { getLocalSummary } from "@/lib/local/service";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const schema = z.object({ projectId: z.string().min(1) });

/**
 * GET /api/v1/local — Local SEO view (PRD §7 module 22).
 *
 * Read-only and free: it reinterprets SERP data already collected rather than
 * calling a provider, so opening the tab never costs anything.
 */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const { projectId } = parseQuery(request, schema);
    const project = await assertProjectAccess(agencyId, projectId);
    const ownDomain = project.domain ?? project.client.domain ?? null;
    return ok(await getLocalSummary(project.id, ownDomain));
  } catch (error) {
    return handleError(error);
  }
}
