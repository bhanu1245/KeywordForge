import { z } from "zod";
import { handleError, ok, parseBody, parseQuery } from "@/lib/api";
import { generateTopicMap, isAiEnabled, type TopicMapPayload } from "@/lib/ai/topicMap";
import { getProjectClusters } from "@/lib/clusters/service";
import { prisma } from "@/lib/db";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const schema = z.object({ projectId: z.string().min(1) });

/** GET /api/v1/topic-map — the most recently generated map, if any. */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const { projectId } = parseQuery(request, schema);
    const project = await assertProjectAccess(agencyId, projectId);

    const saved = await prisma.topicMap.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    if (!saved) return ok({ map: null });

    let map: TopicMapPayload | null = null;
    try {
      map = JSON.parse(saved.content) as TopicMapPayload;
    } catch {
      map = null;
    }
    return ok({ map, createdAt: saved.createdAt });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/v1/topic-map — build the topical authority structure.
 *
 * Runs inline: with no API key the map is pure computation over clusters
 * already in memory, and even the Claude path is a single call.
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const { projectId } = await parseBody(request, schema);
    const project = await assertProjectAccess(agencyId, projectId);

    const clusters = await getProjectClusters(project.id);
    const map = await generateTopicMap(clusters);

    await prisma.topicMap.create({
      data: {
        projectId: project.id,
        content: JSON.stringify(map),
        model: map.generatedBy === "claude" ? process.env.ANTHROPIC_MODEL ?? null : null,
      },
    });

    return ok({ map, aiEnabled: isAiEnabled() });
  } catch (error) {
    return handleError(error);
  }
}
