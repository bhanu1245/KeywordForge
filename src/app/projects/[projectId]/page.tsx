import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { getProjectClusters } from "@/lib/clusters/service";
import { getProjectKeywords } from "@/lib/keywords/service";
import { getRawProvider } from "@/lib/providers";
import { getSerpCoverage } from "@/lib/serp/service";
import {
  assertProjectAccess,
  resolveContext,
  TenantAccessError,
  UnauthenticatedError,
} from "@/lib/tenancy";

export const dynamic = "force-dynamic";

/**
 * Server shell for the workspace. Keywords and clusters are loaded here so the
 * first paint already has data — no client-side loading spinner on open.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Resolved outside the try below: an unauthenticated caller must be sent to
  // /login, not turned into a 404 by the TenantAccessError handler there.
  let context;
  try {
    context = await resolveContext();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }
  const { agencyId } = context;

  try {
    const project = await assertProjectAccess(agencyId, projectId);
    const [keywords, clusters, serpCoverage] = await Promise.all([
      getProjectKeywords(project.id),
      getProjectClusters(project.id),
      getSerpCoverage(project.id),
    ]);

    return (
      <Workspace
        project={{
          id: project.id,
          name: project.name,
          clientName: project.client.name,
          location: project.location,
          language: project.language,
        }}
        initialKeywords={keywords}
        initialClusters={clusters}
        initialSerpCoverage={serpCoverage}
        // Drives the "billable calls" warning on the SERP panel — it must
        // reflect the provider that actually resolved, not the env var.
        isLiveProvider={getRawProvider().isLive}
      />
    );
  } catch (error) {
    // A project belonging to another agency must be indistinguishable from
    // one that does not exist.
    if (error instanceof TenantAccessError) notFound();
    throw error;
  }
}
