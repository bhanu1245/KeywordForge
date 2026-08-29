import { z } from "zod";
import { fail, ok, parseBody } from "@/lib/api";
import { AuthError, attemptLogin } from "@/lib/auth/accounts";
import { createSession } from "@/lib/auth/session";

/**
 * Best-effort client IP.
 *
 * These headers are trivially spoofable unless a trusted proxy sets them, so
 * the per-IP limit is a speed bump against naive scripted attacks, not a
 * guarantee. The per-EMAIL limit is the one that cannot be evaded by forging a
 * header, which is why both are enforced.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

const schema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(200),
});

/** POST /api/v1/auth/login — verify credentials, issue a session cookie. */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, schema);
    const user = await attemptLogin(body.email, body.password, clientIp(request));
    await createSession(user.id, request.headers.get("user-agent"));
    return ok({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    // Never surface an internal message on the auth path — it is the one
    // endpoint an attacker will probe hardest.
    console.error("[auth/login]", error);
    return fail("Could not sign in.", 400);
  }
}
