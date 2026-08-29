import { z } from "zod";
import { fail, ok, parseBody } from "@/lib/api";
import { AuthError, signup } from "@/lib/auth/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const schema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  name: z.string().min(1).max(120),
  agencyName: z.string().max(120).optional(),
  /** Present = join that agency. Absent = create a new one and own it. */
  inviteToken: z.string().min(10).max(200).optional(),
});

/** POST /api/v1/auth/signup — create an account and sign in. */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, schema);
    const user = await signup(body);
    await createSession(user.id, request.headers.get("user-agent"));
    return ok({ id: user.id, email: user.email, name: user.name, role: user.role }, 201);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    if (error instanceof Error && error.message.includes("Password must be")) {
      return fail(error.message, 422);
    }
    console.error("[auth/signup]", error);
    return fail("Could not create that account.", 400);
  }
}
