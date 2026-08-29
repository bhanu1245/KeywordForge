import { z } from "zod";
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { AuthError } from "@/lib/auth/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import {
  completePasswordReset,
  createResetLinkForMember,
  requestPasswordReset,
} from "@/lib/auth/passwordReset";
import { createSession } from "@/lib/auth/session";
import { resolveContext } from "@/lib/tenancy";

const requestSchema = z.object({ email: z.string().min(3).max(320) });

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

const memberSchema = z.object({ userId: z.string().min(1) });

/**
 * POST /api/v1/auth/password — start a reset.
 *
 * Always returns 200 whether or not the address exists. Reporting "no such
 * user" here would turn this endpoint into an account enumerator.
 */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, requestSchema);
    const origin = new URL(request.url).origin;
    const delivery = await requestPasswordReset(body.email, origin);

    return ok({
      // Deliberately constant.
      message: "If that email has an account, a reset link has been created.",
      sent: delivery.sent,
      // Present only outside production when no mail provider is wired, so a
      // solo developer is not locked out of their own instance.
      devLink: delivery.devLink,
    });
  } catch (error) {
    return handleError(error);
  }
}

/** PUT /api/v1/auth/password — consume a token and set a new password. */
export async function PUT(request: Request) {
  try {
    const body = await parseBody(request, resetSchema);
    const user = await completePasswordReset(body.token, body.password);
    // Reset revokes all sessions; issue a fresh one so the user lands signed in.
    await createSession(user.id, request.headers.get("user-agent"));
    return ok({ id: user.id, email: user.email });
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    if (error instanceof Error && error.message.includes("Password must be")) {
      return fail(error.message, 422);
    }
    return handleError(error);
  }
}

/**
 * PATCH /api/v1/auth/password — owner generates a reset link for a member.
 *
 * This is what unblocks users migrated in with passwordHash = NULL while no
 * email provider is configured.
 */
export async function PATCH(request: Request) {
  try {
    const { agencyId, userId } = await resolveContext();
    const body = await parseBody(request, memberSchema);
    const link = await createResetLinkForMember(agencyId, userId, body.userId);

    return ok({
      email: link.email,
      expiresAt: link.expiresAt,
      path: `/reset?token=${encodeURIComponent(link.token)}`,
    });
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return handleError(error);
  }
}
