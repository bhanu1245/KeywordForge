import { z } from "zod";
import { handleError, ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const schema = z.object({
  projectId: z.string().min(1),
  // Percentage in, fraction stored — users think "2%", not "0.02".
  conversionRatePercent: z.number().min(0).max(100).nullable().optional(),
  orderValue: z.number().min(0).max(1_000_000).nullable().optional(),
  position: z.number().int().min(1).max(20).optional(),
});

/**
 * PATCH /api/v1/projects/assumptions — the inputs behind Revenue Potential
 * (PRD §7 module 33).
 *
 * Per project, because they are facts about one client's business. Nullable so
 * "never set" stays distinguishable from "set to zero" and the UI can prompt
 * rather than model revenue on a number nobody chose.
 */
export async function PATCH(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, schema);
    const project = await assertProjectAccess(agencyId, body.projectId);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        ...(body.conversionRatePercent === undefined
          ? {}
          : {
              assumedConversionRate:
                body.conversionRatePercent === null ? null : body.conversionRatePercent / 100,
            }),
        ...(body.orderValue === undefined ? {} : { assumedOrderValue: body.orderValue }),
        ...(body.position === undefined ? {} : { assumedPosition: body.position }),
      },
      select: {
        assumedConversionRate: true,
        assumedOrderValue: true,
        assumedPosition: true,
      },
    });

    return ok({ assumptions: updated });
  } catch (error) {
    return handleError(error);
  }
}
