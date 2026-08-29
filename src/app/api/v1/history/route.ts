import { z } from "zod";
import { handleError, ok, parseQuery } from "@/lib/api";
import { getKeywordHistory, getProjectHistory } from "@/lib/history/service";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const schema = z.object({
  projectId: z.string().min(1),
  /** Omit for the project roll-up; supply for one keyword's series. */
  keywordId: z.string().min(1).optional(),
});

/**
 * GET /api/v1/history — accrued history (PRD §7 module 32).
 *
 * Read-only over data already collected, so it costs nothing to open.
 */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const query = parseQuery(request, schema);
    const project = await assertProjectAccess(agencyId, query.projectId);

    if (query.keywordId) {
      // getKeywordHistory scopes through the project link itself, so a corpus
      // keyword this project never adopted returns null rather than data.
      const history = await getKeywordHistory(project.id, query.keywordId);
      return ok({ history });
    }

    return ok(await getProjectHistory(project.id));
  } catch (error) {
    return handleError(error);
  }
}
