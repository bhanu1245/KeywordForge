import { z } from "zod";
import { handleError, ok, parseBody, parseQuery } from "@/lib/api";
import {
  ALERT_TYPES,
  acknowledgeEvents,
  createAlert,
  listAlerts,
  setAlertEnabled,
  type AlertType,
} from "@/lib/alerts/service";
import { assertProjectAccess, resolveContext } from "@/lib/tenancy";

const getSchema = z.object({ projectId: z.string().min(1) });

const postSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(ALERT_TYPES),
  threshold: z.number().int().min(1).max(100).optional(),
});

const patchSchema = z.object({
  projectId: z.string().min(1),
  alertId: z.string().min(1),
  enabled: z.boolean().optional(),
  acknowledge: z.boolean().optional(),
});

/** GET /api/v1/alerts — configured alerts and their recent events. */
export async function GET(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const { projectId } = parseQuery(request, getSchema);
    const project = await assertProjectAccess(agencyId, projectId);
    return ok({ alerts: await listAlerts(project.id) });
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/v1/alerts — create or update an alert rule. */
export async function POST(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, postSchema);
    const project = await assertProjectAccess(agencyId, body.projectId);
    const alert = await createAlert(
      project.id,
      body.type as AlertType,
      body.threshold ?? 3,
    );
    return ok({ id: alert.id, type: alert.type, threshold: alert.threshold }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH /api/v1/alerts — enable/disable, or acknowledge fired events. */
export async function PATCH(request: Request) {
  try {
    const { agencyId } = await resolveContext();
    const body = await parseBody(request, patchSchema);
    const project = await assertProjectAccess(agencyId, body.projectId);

    if (body.enabled !== undefined) {
      await setAlertEnabled(project.id, body.alertId, body.enabled);
    }
    if (body.acknowledge) {
      await acknowledgeEvents(project.id, body.alertId);
    }
    return ok({ alerts: await listAlerts(project.id) });
  } catch (error) {
    return handleError(error);
  }
}
