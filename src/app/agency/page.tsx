import { redirect } from "next/navigation";
import { AgencySettings } from "@/components/AgencySettings";
import { getAgencyOverview } from "@/lib/agency/service";
import { prisma } from "@/lib/db";
import { resolveContext, UnauthenticatedError } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

/** Agency Mode settings (PRD §7 module 36). */
export default async function AgencyPage() {
  let context;
  try {
    context = await resolveContext();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  const overview = await getAgencyOverview(context.agencyId);
  const members = await prisma.user.findMany({
    where: { agencyId: context.agencyId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, lastLoginAt: true },
  });

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-10">
      <AgencySettings
        agencyName={overview.agencyName}
        branding={overview.branding}
        clients={overview.clients}
        totals={overview.totals}
        members={members.map((m) => ({
          ...m,
          lastLoginAt: m.lastLoginAt ? m.lastLoginAt.toISOString() : null,
        }))}
        isOwner={context.role === "owner"}
      />
    </main>
  );
}
