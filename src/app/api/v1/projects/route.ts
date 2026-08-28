import { z } from "zod";
import { handleError, ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertClientAccess, resolveContext } from "@/lib/tenancy";

/** GET /api/v1/projects — every project this agency can see, grouped by client. */
export async function GET() {
  try {
    const { agencyId } = await resolveContext();
    const clients = await prisma.client.findMany({
      where: { agencyId },
      orderBy: { name: "asc" },
      include: {
        projects: {
          orderBy: { name: "asc" },
          include: { _count: { select: { projectKeywords: true, clusters: true } } },
        },
      },
    });

    return ok({
      clients: clients.map((client) => ({
        id: client.id,
        name: client.name,
        domain: client.domain,
        projects: client.projects.map((p) => ({
          id: p.id,
          name: p.name,
          domain: p.domain,
          language: p.language,
          location: p.location,
          keywordCount: p._count.projectKeywords,
          clusterCount: p._count.clusters,
        })),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Accepts either an existing `clientId` or a `clientName` to create alongside
 * the project. One endpoint rather than two so the "research a brand new
 * niche" path is a single request — that flow is the common one, and making
 * people create a client first was the main thing stopping this tool from
 * being usable for arbitrary keywords.
 */
const createSchema = z
  .object({
    name: z.string().min(1).max(120),
    clientId: z.string().min(1).optional(),
    clientName: z.string().min(1).max(120).optional(),
    domain: z.string().max(253).optional(),
    language: z.string().min(2).max(8).default("en"),
    location: z.string().min(2).max(80).default("United States"),
  })
  .refine((v) => Boolean(v.clientId || v.clientName), {
    message: "Provide either clientId or clientName",
    path: ["clientName"],
  });

/** POST /api/v1/projects — create a project (and its client if needed). */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, createSchema);

    let clientId: string;
    if (body.clientId) {
      // Never trust a client id from the request — verify it is ours.
      const client = await assertClientAccess(agencyId, body.clientId);
      clientId = client.id;
    } else {
      const name = body.clientName!.trim();
      // Reuse a client of the same name rather than creating duplicates when
      // someone adds a second project for an existing customer.
      const existing = await prisma.client.findFirst({
        where: { agencyId, name },
      });
      clientId =
        existing?.id ??
        (
          await prisma.client.create({
            data: { agencyId, name, domain: body.domain || null },
          })
        ).id;
    }

    const project = await prisma.project.create({
      data: {
        clientId,
        name: body.name.trim(),
        domain: body.domain || null,
        language: body.language,
        location: body.location,
      },
    });

    return ok(
      {
        id: project.id,
        name: project.name,
        clientId: project.clientId,
        language: project.language,
        location: project.location,
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
