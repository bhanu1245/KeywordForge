import { z } from "zod";
import { handleError, ok, parseQuery } from "@/lib/api";
import { getProjectKeywords, type KeywordFilters } from "@/lib/keywords/service";
import { INTENTS } from "@/lib/seo/intent";
import { CHANNELS } from "@/lib/providers/types";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

/** Query params arrive as strings; coerce and validate in one place. */
const schema = z.object({
  projectId: z.string().min(1),
  search: z.string().optional(),
  minVolume: z.coerce.number().int().min(0).optional(),
  maxVolume: z.coerce.number().int().min(0).optional(),
  minDifficulty: z.coerce.number().int().min(0).max(100).optional(),
  maxDifficulty: z.coerce.number().int().min(0).max(100).optional(),
  minWords: z.coerce.number().int().min(1).optional(),
  questionsOnly: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  intents: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")))
    .optional(),
  seed: z.string().optional(),
  channel: z.enum(CHANNELS).optional(),
  trendDirection: z.enum(["rising", "falling", "stable"]).optional(),
  seasonalOnly: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
});

/** GET /api/v1/keywords?projectId=... — the explorer's filtered read. */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const query = parseQuery(request, schema);
    const project = await assertProjectAccess(agencyId, query.projectId);

    const intents = query.intents?.filter((i): i is (typeof INTENTS)[number] =>
      (INTENTS as readonly string[]).includes(i),
    );

    const filters: KeywordFilters = {
      search: query.search,
      minVolume: query.minVolume,
      maxVolume: query.maxVolume,
      minDifficulty: query.minDifficulty,
      maxDifficulty: query.maxDifficulty,
      minWords: query.minWords,
      questionsOnly: query.questionsOnly,
      intents: intents?.length ? intents : undefined,
      seed: query.seed,
      channel: query.channel,
      trendDirection: query.trendDirection,
      seasonalOnly: query.seasonalOnly,
    };

    const keywords = await getProjectKeywords(project.id, filters);

    // Summary is computed over the filtered set so the header stats always
    // describe exactly what is on screen.
    const totalVolume = keywords.reduce((n, k) => n + (k.volume ?? 0), 0);
    const avgDifficulty =
      keywords.length === 0
        ? 0
        : Number(
            (keywords.reduce((n, k) => n + k.difficulty, 0) / keywords.length).toFixed(1),
          );

    return ok({
      keywords,
      summary: {
        count: keywords.length,
        totalVolume,
        avgDifficulty,
        totalValue: Number(
          keywords.reduce((n, k) => n + k.commercialValue, 0).toFixed(2),
        ),
        questions: keywords.filter((k) => k.isQuestion).length,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
