import { notFound, redirect } from "next/navigation";
import { getAgencyOverview } from "@/lib/agency/service";
import { getProjectClusters } from "@/lib/clusters/service";
import { getProjectAssumptions, getProjectKeywords } from "@/lib/keywords/service";
import { getRankSummary } from "@/lib/rank/service";
import {
  assertProjectAccess,
  resolveContext,
  TenantAccessError,
  UnauthenticatedError,
} from "@/lib/tenancy";

export const dynamic = "force-dynamic";

/**
 * Branded client report (PRD §7 module 36, §8 flow 5).
 *
 * Rendered as a print-optimised HTML page rather than a generated PDF: there
 * is no PDF library in this project, and adding one to produce a document the
 * browser can already export via Ctrl-P would be weight for no gain. The page
 * carries the agency's colour, logo and footer, and hides all app chrome when
 * printed.
 *
 * The honesty rule from the rest of the app applies here MOST — this is the
 * artefact a client actually reads, so difficulty and revenue both carry their
 * caveats inline rather than being presented as measurements.
 */
export default async function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let context;
  try {
    context = await resolveContext();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  try {
    const project = await assertProjectAccess(context.agencyId, projectId);
    const [overview, keywords, clusters, assumptions, ranks] = await Promise.all([
      getAgencyOverview(context.agencyId),
      getProjectKeywords(project.id),
      getProjectClusters(project.id),
      getProjectAssumptions(project.id),
      getRankSummary(project.id, project.domain ?? project.client.domain ?? null),
    ]);

    const { branding } = overview;
    const accent = branding.primaryColor;

    const totalVolume = keywords.reduce((n, k) => n + (k.volume ?? 0), 0);
    const totalRevenue = keywords.reduce((n, k) => n + k.revenuePotential, 0);
    const avgDifficulty =
      keywords.length === 0
        ? 0
        : Math.round(keywords.reduce((n, k) => n + k.difficulty, 0) / keywords.length);

    const topKeywords = [...keywords]
      .sort((a, b) => b.opportunity - a.opportunity)
      .slice(0, 25);
    const topClusters = [...clusters].sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 10);

    const num = (n: number | null) => (n === null ? "—" : n.toLocaleString());

    return (
      <main className="mx-auto max-w-[900px] px-6 py-10 print:max-w-none print:px-0 print:py-0">
        {/* Screen-only toolbar. */}
        <div className="mb-6 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 print:hidden">
          <p className="text-xs text-muted">
            Print or save as PDF from your browser (Ctrl/Cmd + P).
          </p>
          <a
            href={`/projects/${project.id}`}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink hover:bg-elevated"
          >
            Back to workspace
          </a>
        </div>

        <article className="rounded-2xl border border-line bg-white p-10 text-slate-900 print:rounded-none print:border-0 print:p-0">
          <header
            className="flex items-start justify-between gap-6 border-b-4 pb-5"
            style={{ borderColor: accent }}
          >
            <div>
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary
                // remote logo; next/image would need per-agency domain config.
                <img
                  src={branding.logoUrl}
                  alt=""
                  className="mb-3 h-10 w-auto object-contain"
                />
              ) : (
                <div
                  className="mb-3 inline-grid size-9 place-items-center rounded-lg text-sm font-bold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {(branding.reportTitle ?? overview.agencyName).charAt(0)}
                </div>
              )}
              <h1 className="text-2xl font-semibold tracking-tight">
                {project.client.name}
              </h1>
              <p className="mt-0.5 text-sm text-slate-600">
                {project.name} · {project.location}
              </p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div className="font-medium text-slate-700">
                {branding.reportTitle ?? overview.agencyName}
              </div>
              <div className="mt-0.5">
                {new Date().toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </div>
            </div>
          </header>

          <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Keywords", keywords.length.toLocaleString()],
              ["Monthly searches", totalVolume.toLocaleString()],
              ["Avg. difficulty", String(avgDifficulty)],
              ["Topic clusters", clusters.length.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
                <div className="mt-0.5 text-lg font-semibold" style={{ color: accent }}>
                  {value}
                </div>
              </div>
            ))}
          </section>

          {ranks.tracked > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Current rankings
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
                <div><strong>{ranks.ranking}</strong> ranking</div>
                <div><strong>{ranks.topThree}</strong> in top 3</div>
                <div><strong>{ranks.topTen}</strong> in top 10</div>
                <div>
                  avg position <strong>{ranks.averagePosition ?? "—"}</strong>
                </div>
              </div>
            </section>
          )}

          {assumptions.configured && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Revenue potential
              </h2>
              <p className="mt-1 text-2xl font-semibold" style={{ color: accent }}>
                ${Math.round(totalRevenue).toLocaleString()}
                <span className="ml-1 text-sm font-normal text-slate-500">/ month, modelled</span>
              </p>
              {/* The caveat travels with the number, in the client-facing
                  document above all. */}
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Modelled estimate, not a measurement or a forecast. {assumptions.description}{" "}
                Search volumes are the data provider&apos;s modelled figures and click-through
                rates come from a generic industry curve.
              </p>
            </section>
          )}

          {topClusters.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Priority topics
              </h2>
              <table className="mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5">Topic</th>
                    <th className="py-1.5 text-right">Keywords</th>
                    <th className="py-1.5 text-right">Searches/mo</th>
                    <th className="py-1.5 text-right">Avg. difficulty</th>
                  </tr>
                </thead>
                <tbody>
                  {topClusters.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3">{c.name}</td>
                      <td className="py-1.5 text-right">{c.keywordCount}</td>
                      <td className="py-1.5 text-right">{c.totalVolume.toLocaleString()}</td>
                      <td className="py-1.5 text-right">{Math.round(c.avgDifficulty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Top opportunities
            </h2>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5">Keyword</th>
                  <th className="py-1.5 text-right">Searches</th>
                  <th className="py-1.5 text-right">Difficulty</th>
                  <th className="py-1.5">Intent</th>
                  <th className="py-1.5 text-right">Opportunity</th>
                </tr>
              </thead>
              <tbody>
                {topKeywords.map((k) => (
                  <tr key={k.projectKeywordId} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">{k.text}</td>
                    <td className="py-1.5 text-right">{num(k.volume)}</td>
                    <td className="py-1.5 text-right">{k.difficulty}</td>
                    <td className="py-1.5 capitalize">{k.intent}</td>
                    <td className="py-1.5 text-right font-medium" style={{ color: accent }}>
                      {k.opportunity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Difficulty is a proxy score computed from paid competition, search volume, phrase
              length and SERP composition. It ranks these keywords against each other; it is not
              comparable to an Ahrefs or Moz difficulty score.
            </p>
          </section>

          <footer className="mt-10 border-t border-slate-200 pt-4 text-[11px] text-slate-500">
            {branding.footerText ? (
              <p>{branding.footerText}</p>
            ) : (
              <p>Prepared by {overview.agencyName}.</p>
            )}
          </footer>
        </article>
      </main>
    );
  } catch (error) {
    if (error instanceof TenantAccessError) notFound();
    throw error;
  }
}
