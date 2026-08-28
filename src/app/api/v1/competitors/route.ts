import { z } from "zod";
import { handleError, ok, parseBody, parseQuery } from "@/lib/api";
import {
  addCompetitor,
  getCompetitorKeywords,
  getCompetitorLandscape,
  getContentGap,
  removeCompetitor,
} from "@/lib/competitors/service";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const getSchema = z.object({
  projectId: z.string().min(1),
  /** Supply a domain for its keyword list; omit for the whole landscape. */
  domain: z.string().min(3).optional(),
  /** "gap" returns the topic-level Content Gap instead. */
  view: z.enum(["landscape", "keywords", "gap"]).optional(),
});

const postSchema = z.object({
  projectId: z.string().min(1),
  domain: z.string().min(3).max(253),
});

const deleteSchema = postSchema;

/**
 * GET /api/v1/competitors
 *   ?view=landscape        every domain seen in this project's SERPs
 *   ?view=keywords&domain= what that competitor ranks for, vs us
 *   ?view=gap              topic-level content gap
 */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const query = parseQuery(request, getSchema);
    const project = await assertProjectAccess(agencyId, query.projectId);
    const ownDomain = project.domain ?? project.client.domain ?? null;

    const view = query.view ?? (query.domain ? "keywords" : "landscape");

    if (view === "keywords") {
      if (!query.domain) return ok({ keywords: [] });
      return ok({
        ownDomain,
        keywords: await getCompetitorKeywords(project.id, query.domain, ownDomain),
      });
    }

    if (view === "gap") {
      return ok({ ownDomain, clusters: await getContentGap(project.id, ownDomain) });
    }

    return ok({ ownDomain, competitors: await getCompetitorLandscape(project.id) });
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/v1/competitors — track a competitor domain. */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, postSchema);
    const project = await assertProjectAccess(agencyId, body.projectId);
    const competitor = await addCompetitor(project.id, body.domain);
    return ok({ id: competitor.id, domain: competitor.domain }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/v1/competitors — stop tracking a domain. */
export async function DELETE(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, deleteSchema);
    const project = await assertProjectAccess(agencyId, body.projectId);
    await removeCompetitor(project.id, body.domain);
    return ok({ removed: true });
  } catch (error) {
    return handleError(error);
  }
}
