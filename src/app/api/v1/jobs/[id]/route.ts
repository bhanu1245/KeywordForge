import { handleError, ok } from "@/lib/api";
import { assertJobAccess, resolveContext } from "@/lib/tenancy";

/** GET /api/v1/jobs/{id} — progress polling for every async operation. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { agencyId } = await resolveContext();
    const { id } = await params;
    const job = await assertJobAccess(agencyId, id);

    return ok({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      total: job.total,
      // Percent is computed server-side so every client shows the same number.
      percent:
        job.total > 0
          ? Math.min(100, Math.round((job.progress / job.total) * 100))
          : job.status === "completed"
            ? 100
            : 0,
      result: job.result ? JSON.parse(job.result) : null,
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    });
  } catch (error) {
    return handleError(error);
  }
}
