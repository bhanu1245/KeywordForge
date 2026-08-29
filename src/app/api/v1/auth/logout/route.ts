import { ok } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";

/**
 * POST /api/v1/auth/logout — revoke the session server-side and clear the
 * cookie. Always succeeds, even with no session, so a double-click cannot
 * produce an error.
 */
export async function POST() {
  await destroySession();
  return ok({ signedOut: true });
}
