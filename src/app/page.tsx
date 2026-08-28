import Link from "next/link";
import { Icon } from "@/components/Icon";
import { NewProjectForm } from "@/components/NewProjectForm";
import { EmptyState, formatCompact, formatNumber } from "@/components/ui";
import { prisma } from "@/lib/db";
import { resolveContext } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

/**
 * Client/project picker. Multi-tenancy is visible from the first screen
 * (PRD §7: multi-tenancy belongs in the model from Phase 1) even though the
 * polished white-label Agency Mode UI is a later phase.
 */
export default async function HomePage() {
  const { agencyId } = await resolveContext();

  const clients = await prisma.client.findMany({
    where: { agencyId },
    orderBy: { name: "asc" },
    include: {
      projects: {
        orderBy: { name: "asc" },
        include: { _count: { select: { projectKeywords: true, clusters: true } } },
      },
    },
  });

  const totalProjects = clients.reduce((n, c) => n + c.projects.length, 0);
  const totalKeywords = clients.reduce(
    (n, c) => n + c.projects.reduce((m, p) => m + p._count.projectKeywords, 0),
    0,
  );

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Clients</h1>
          <p className="mt-1.5 text-sm text-muted">
            Open a project to research its keywords, or start a new one for any niche.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-subtle">
          <span className="nums">
            <strong className="text-ink">{clients.length}</strong> clients
          </span>
          <span className="nums">
            <strong className="text-ink">{totalProjects}</strong> projects
          </span>
          <span className="nums">
            <strong className="text-ink">{formatCompact(totalKeywords)}</strong> keywords
          </span>
        </div>
      </div>

      <div className="mt-6">
        <NewProjectForm existingClients={clients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      {clients.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="No clients yet"
            hint="Create your first project above to start researching keywords for any niche."
          />
        </div>
      ) : (
        <div className="mt-10 space-y-9">
          {clients.map((client) => (
            <section key={client.id}>
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-sm font-semibold text-ink">{client.name}</h2>
                {client.domain && (
                  <span className="inline-flex items-center gap-1 text-xs text-subtle">
                    <Icon name="external" size={11} />
                    {client.domain}
                  </span>
                )}
                <span className="ml-auto text-xs text-subtle">
                  {client.projects.length} project{client.projects.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {client.projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="group relative overflow-hidden rounded-xl border border-line bg-surface p-4 transition-all hover:border-line-strong hover:bg-elevated"
                  >
                    {/* Accent edge that only appears on hover — keeps the
                        resting grid calm while making the target obvious. */}
                    <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-soft opacity-0 transition-opacity group-hover:opacity-100" />

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink transition-colors group-hover:text-brand-soft">
                          {project.name}
                        </div>
                        <div className="mt-1 text-xs text-subtle">
                          {project.location} · {project.language.toUpperCase()}
                        </div>
                      </div>
                      <Icon
                        name="chevronRight"
                        size={15}
                        className="mt-0.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand-soft"
                      />
                    </div>

                    <div className="mt-3.5 flex items-center gap-4 border-t border-line pt-3 text-xs text-muted">
                      <span className="nums inline-flex items-center gap-1.5">
                        <Icon name="table" size={12} className="text-subtle" />
                        <strong className="font-medium text-ink">
                          {formatNumber(project._count.projectKeywords)}
                        </strong>
                        keywords
                      </span>
                      <span className="nums inline-flex items-center gap-1.5">
                        <Icon name="layers" size={12} className="text-subtle" />
                        <strong className="font-medium text-ink">
                          {formatNumber(project._count.clusters)}
                        </strong>
                        clusters
                      </span>
                    </div>
                  </Link>
                ))}

                {client.projects.length === 0 && (
                  <p className="text-sm text-subtle">No projects yet.</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
