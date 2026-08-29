/**
 * Seeds the demo tenant. Idempotent — safe to re-run.
 *
 * Creates one agency with two clients so that tenant isolation is visible in
 * the UI from the first run (and so a bug that leaks data between clients is
 * obvious rather than theoretical).
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

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

  // Dev credentials. Deliberately a throwaway password on a .test domain —
  // this seed never runs against production data, and DEV_AUTO_LOGIN_EMAIL
  // exists so local work does not need it at all.
  const devEmail = "bhanu@primewebmedia.test";
  const devPassword = "keywordforge-dev";
  const passwordHash = await bcrypt.hash(devPassword, 12);

  await prisma.user.upsert({
    where: { email: devEmail },
    // Re-seeding resets the password so a forgotten local password is never a
    // blocker; it does not touch anything else about the user.
    update: { passwordHash },
    create: {
      agencyId: agency.id,
      email: devEmail,
      name: "Bhanu",
      role: "owner",
      passwordHash,
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
  console.log(`Dev login: ${devEmail} / ${devPassword}`);
  console.log(
    "Or set DEV_AUTO_LOGIN_EMAIL in .env to skip the login form locally.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
