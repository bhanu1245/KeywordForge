/**
 * Next.js startup hook.
 *
 * The in-process job runner cannot survive a restart (see lib/jobs/runner.ts),
 * so any job still marked running belongs to a dead process. Failing them on
 * boot means a user sees "interrupted, re-run it" instead of a progress bar
 * that never moves.
 */
export async function register() {
  // Guard the runtime: this module is also evaluated in the edge runtime,
  // where Prisma and the job runner are not available.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { reapStalledJobs } = await import("./lib/jobs/runner");
    const reaped = await reapStalledJobs();
    if (reaped > 0) {
      console.log(`[jobs] marked ${reaped} interrupted job(s) as failed on boot`);
    }
  } catch (error) {
    // A failure here must never stop the server from booting.
    console.warn("[jobs] could not reap stalled jobs on boot:", error);
  }
}
