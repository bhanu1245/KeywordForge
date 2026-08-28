/**
 * Seeds the demo tenant. Idempotent — safe to re-run.
 *
 * Creates one agency with two clients so that tenant isolation is visible in
 * the UI from the first run (and so a bug that leaks data between clients is
 * obvious rather than theoretical).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const agency = await prisma.agency.upsert({
    where: { slug: "prime-web-media" },
    update: {},
    create: {
      name: "Prime Web Media",
      slug: "prime-web-media",
      branding: JSON.stringify({ primaryColor: "#4f46e5", logoUrl: null }),
    },
  });

  await prisma.user.upsert({
    where: { email: "bhanu@primewebmedia.test" },
    update: {},
    create: {
      agencyId: agency.id,
      email: "bhanu@primewebmedia.test",
      name: "Bhanu",
      role: "owner",
    },
  });

  const clients = [
    {
      name: "Aurora Jewellery",
      domain: "aurorajewellery.test",
      project: {
        name: "Aurora — Organic Growth",
        domain: "aurorajewellery.test",
        location: "United States",
      },
    },
    {
      name: "Saffron Bistro",
      domain: "saffronbistro.test",
      project: {
        name: "Saffron — Local SEO",
        domain: "saffronbistro.test",
        location: "United States",
      },
    },
  ];

  for (const entry of clients) {
    const existingClient = await prisma.client.findFirst({
      where: { agencyId: agency.id, name: entry.name },
    });

    const client =
      existingClient ??
      (await prisma.client.create({
        data: { agencyId: agency.id, name: entry.name, domain: entry.domain },
      }));

    const existingProject = await prisma.project.findFirst({
      where: { clientId: client.id, name: entry.project.name },
    });

    if (!existingProject) {
      await prisma.project.create({
        data: {
          clientId: client.id,
          name: entry.project.name,
          domain: entry.project.domain,
          language: "en",
          location: entry.project.location,
        },
      });
    }
  }

  const projectCount = await prisma.project.count();
  console.log(
    `Seeded agency "${agency.name}" (${agency.id}) with ${clients.length} clients and ${projectCount} projects.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
