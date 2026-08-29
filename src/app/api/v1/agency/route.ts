import { z } from "zod";
import { fail, handleError, ok, parseBody } from "@/lib/api";
import {
  getAgencyOverview,
  isSafeImageUrl,
  isValidHexColor,
  updateBranding,
} from "@/lib/agency/service";
import { resolveContext } from "@/lib/tenancy";

const schema = z.object({
  primaryColor: z.string().max(20).optional(),
  logoUrl: z.string().max(2048).nullable().optional(),
  reportTitle: z.string().max(120).nullable().optional(),
  footerText: z.string().max(400).nullable().optional(),
});

/** GET /api/v1/agency — client roster + branding for Agency Mode. */
export async function GET() {
  try {
    const { agencyId } = await resolveContext();
    return ok(await getAgencyOverview(agencyId));
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH /api/v1/agency — update white-label branding. Owner only. */
export async function PATCH(request: Request) {
  try {
    const { agencyId, role } = await resolveContext();
    if (role !== "owner") {
      return fail("Only an agency owner can change branding.", 403);
    }

    const body = await parseBody(request, schema);

    // Validated here as well as in the service so the user gets a specific
    // message rather than the value being silently ignored.
    if (body.primaryColor && !isValidHexColor(body.primaryColor)) {
      return fail("Primary colour must be a hex value like #4f46e5.", 422);
    }
    if (body.logoUrl && !isSafeImageUrl(body.logoUrl)) {
      return fail("Logo URL must be an absolute http(s) URL.", 422);
    }

    return ok({ branding: await updateBranding(agencyId, body) });
  } catch (error) {
    return handleError(error);
  }
}
