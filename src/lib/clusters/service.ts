/**
 * Persisting clustering results (PRD §8 flow 2).
 *
 * Regeneration replaces a project's clusters wholesale rather than trying to
 * diff them. Clustering is a global optimisation — adding 200 new keywords
 * legitimately reshuffles which head term owns which group — so an incremental
 * merge would produce clusters that no longer match what the algorithm would
 * produce from scratch, which is worse than a clean rebuild.
 */

import { prisma } from "../db";
import { clusterKeywords, type ClusterInputKeyword } from "../seo/cluster";
import { getProjectKeywords } from "../keywords/service";

export interface GenerateClustersInput {
  projectId: string;
  threshold?: number;
  minClusterSize?: number;
}

export interface GenerateClustersResult {
  clusterCount: number;
  keywordsClustered: number;
}

export async function generateClustersForProject(
  input: GenerateClustersInput,
): Promise<GenerateClustersResult> {
  const rows = await getProjectKeywords(input.projectId);
  if (rows.length === 0) return { clusterCount: 0, keywordsClustered: 0 };

  // Cluster on the ProjectKeyword id: clusters are tenant-scoped work, and
  // the same corpus keyword can sit in different clusters for two clients.
  const inputs: ClusterInputKeyword[] = rows.map((r) => ({
    id: r.projectKeywordId,
    text: r.text,
    volume: r.volume,
    difficulty: r.difficulty,
    intent: r.intent,
    intentConfidence: r.intentConfidence,
  }));

  const clusters = clusterKeywords(inputs, {
    threshold: input.threshold,
    minClusterSize: input.minClusterSize,
  });

  await prisma.$transaction(async (tx) => {
    await tx.cluster.deleteMany({ where: { projectId: input.projectId } });

    for (const c of clusters) {
      await tx.cluster.create({
        data: {
          projectId: input.projectId,
          name: c.name,
          intent: c.intent,
          totalVolume: c.totalVolume,
          avgDifficulty: c.avgDifficulty,
          keywordCount: c.keywordIds.length,
          keywords: {
            create: c.keywordIds.map((projectKeywordId) => ({
              projectKeywordId,
              isPrimary: projectKeywordId === c.primaryId,
            })),
          },
        },
      });
    }
  });

  return {
    clusterCount: clusters.length,
    keywordsClustered: clusters.reduce((n, c) => n + c.keywordIds.length, 0),
  };
}

export async function getProjectClusters(projectId: string) {
  const clusters = await prisma.cluster.findMany({
    where: { projectId },
    orderBy: { totalVolume: "desc" },
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

  return clusters.map((c) => ({
    id: c.id,
    name: c.name,
    intent: c.intent,
    totalVolume: c.totalVolume,
    avgDifficulty: c.avgDifficulty,
    keywordCount: c.keywordCount,
    keywords: c.keywords
      .map((ck) => ({
        id: ck.projectKeyword.id,
        text: ck.projectKeyword.keyword.text,
        isPrimary: ck.isPrimary,
        volume: ck.projectKeyword.keyword.metrics[0]?.volume ?? null,
        difficulty: ck.projectKeyword.keyword.metrics[0]?.difficulty ?? null,
        intent: ck.projectKeyword.keyword.intent,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (b.volume ?? 0) - (a.volume ?? 0)),
  }));
}
