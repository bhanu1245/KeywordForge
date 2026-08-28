import { z } from "zod";
import { handleError, ok, parseBody, parseQuery } from "@/lib/api";
import { generateClustersForProject, getProjectClusters } from "@/lib/clusters/service";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const getSchema = z.object({ projectId: z.string().min(1) });

const postSchema = z.object({
  projectId: z.string().min(1),
  /** Higher = tighter clusters. See cluster.ts for how this is tuned. */
  threshold: z.number().min(0.05).max(0.95).optional(),
  minClusterSize: z.number().int().min(1).max(50).optional(),
});

/** GET /api/v1/clusters?projectId=... */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const { projectId } = parseQuery(request, getSchema);
    const project = await assertProjectAccess(agencyId, projectId);
    return ok({ clusters: await getProjectClusters(project.id) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/v1/clusters — regenerate this project's clusters.
 *
 * Runs inline: clustering is pure CPU with no upstream API calls, and 10K
 * keywords cluster in well under a second, so a job round trip would only add
 * latency. Bulk enrichment, which does hit the paid API, stays async.
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, postSchema);
    const project = await assertProjectAccess(agencyId, body.projectId);

    const result = await generateClustersForProject({
      projectId: project.id,
      threshold: body.threshold,
      minClusterSize: body.minClusterSize,
    });

    return ok({ ...result, clusters: await getProjectClusters(project.id) });
  } catch (error) {
    return handleError(error);
  }
}
