import { z } from "zod";
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { AuthError, createInvite } from "@/lib/auth/accounts";
import { prisma } from "@/lib/db";
import { resolveContext } from "@/lib/tenancy";

const schema = z.object({
  email: z.string().max(320).optional(),
  role: z.enum(["member", "owner"]).optional(),
});

/** GET /api/v1/auth/invites — outstanding invites for this agency. */
export async function GET() {
  try {
    const { agencyId } = await resolveContext();
    const invites = await prisma.invite.findMany({
      where: { agencyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      // Never select tokenHash — nothing downstream should see it.
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
    const members = await prisma.user.findMany({
      where: { agencyId },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true },
    });
    return ok({ invites, members });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/v1/auth/invites — owner generates a one-time link.
 *
 * The plaintext token is returned ONCE and never stored, so it cannot be
 * retrieved later; losing it means issuing a new invite.
 */
export async function POST(request: Request) {
  try {
    const { agencyId, userId } = await resolveContext();
    const body = await parseBody(request, schema);

    const invite = await createInvite({
      agencyId,
      createdById: userId,
      role: body.role,
      email: body.email?.trim() || undefined,
    });

    return ok(
      {
        id: invite.id,
        token: invite.token,
        expiresAt: invite.expiresAt,
        // Path only — the caller's origin builds the absolute URL, so this
        // never depends on a spoofable Host header.
        path: `/signup?invite=${encodeURIComponent(invite.token)}`,
      },
      201,
    );
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return handleError(error);
  }
}
