import { z } from "zod";
import { handleError, ok, parseBody } from "@/lib/api";
import { generateContentBrief, isAiEnabled } from "@/lib/ai/claude";
import { prisma } from "@/lib/db";
import { assertClusterAccess, resolveContext } from "@/lib/tenancy";

const schema = z.object({ clusterId: z.string().min(1) });

/**
 * POST /api/v1/briefs/generate — cluster -> content brief (PRD §8 flow 3).
 *
 * Works without an ANTHROPIC_API_KEY: the service falls back to a brief
 * derived from the cluster's own question keywords and secondary terms, so
 * the flow is never a dead end.
 */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const { clusterId } = await parseBody(request, schema);
    await assertClusterAccess(agencyId, clusterId);

    const cluster = await prisma.cluster.findUniqueOrThrow({
      where: { id: clusterId },
      include: {
        keywords: {
          include: {
            projectKeyword: {
              include: {
                keyword: {
                  include: { metrics: { orderBy: { capturedAt: "desc" }, take: 1 } },
                },
              },
            },
          },
        },
      },
    });

    const keywords = cluster.keywords.map((ck) => ({
      text: ck.projectKeyword.keyword.text,
      volume: ck.projectKeyword.keyword.metrics[0]?.volume ?? null,
      difficulty: ck.projectKeyword.keyword.metrics[0]?.difficulty ?? null,
    }));

    const brief = await generateContentBrief(cluster.name, keywords);

    const saved = await prisma.contentBrief.create({
      data: {
        clusterId: cluster.id,
        title: brief.title,
        content: JSON.stringify(brief),
        model: brief.generatedBy === "claude" ? process.env.ANTHROPIC_MODEL ?? null : null,
      },
    });

    return ok({
      id: saved.id,
      brief,
      // Surfaced so the UI can say plainly which engine produced this.
      aiEnabled: isAiEnabled(),
    });
  } catch (error) {
    return handleError(error);
  }
}
