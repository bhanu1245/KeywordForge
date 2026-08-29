/**
 * Agency Mode (PRD §7 module 36) — branding and the client roster.
 *
 * Scope, per the PRD's own non-goals: white-label branding and multi-client
 * management for running client work. NOT a reseller marketplace.
 *
 * Branding reuses the `Agency.branding` JSON column that has existed since
 * Phase 1 (seeded as `{ primaryColor, logoUrl }`) rather than adding new
 * columns — the shape is extended, the storage is not.
 */

import { prisma } from "../db";

export interface Branding {
  primaryColor: string;
  logoUrl: string | null;
  /** Shown on reports instead of the agency name when set. */
  reportTitle: string | null;
  /** Free text in the report footer — contact details, disclaimers. */
  footerText: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  primaryColor: "#4f46e5",
  logoUrl: null,
  reportTitle: null,
  footerText: null,
};

/** Only #RGB / #RRGGBB. A colour string lands in a `style` attribute on the
 *  report page, so anything else is refused rather than sanitised. */
export function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** Only absolute http(s) URLs — blocks `javascript:` and `data:` in an <img>. */
export function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseBranding(raw: string | null | undefined): Branding {
  if (!raw) return { ...DEFAULT_BRANDING };
  try {
    const parsed = JSON.parse(raw) as Partial<Branding>;
    return {
      // Re-validate on READ, not just on write. Existing rows predate the
      // validation, and a bad value must not reach the report's style attr.
      primaryColor:
        typeof parsed.primaryColor === "string" && isValidHexColor(parsed.primaryColor)
          ? parsed.primaryColor
          : DEFAULT_BRANDING.primaryColor,
      logoUrl:
        typeof parsed.logoUrl === "string" && isSafeImageUrl(parsed.logoUrl)
          ? parsed.logoUrl
          : null,
      reportTitle: typeof parsed.reportTitle === "string" ? parsed.reportTitle : null,
      footerText: typeof parsed.footerText === "string" ? parsed.footerText : null,
    };
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}

export async function getBranding(agencyId: string): Promise<Branding> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { branding: true },
  });
  return parseBranding(agency?.branding);
}

export async function updateBranding(
  agencyId: string,
  patch: Partial<Branding>,
): Promise<Branding> {
  const current = await getBranding(agencyId);
  const next: Branding = {
    primaryColor:
      patch.primaryColor && isValidHexColor(patch.primaryColor)
        ? patch.primaryColor
        : current.primaryColor,
    logoUrl:
      patch.logoUrl === null
        ? null
        : patch.logoUrl && isSafeImageUrl(patch.logoUrl)
          ? patch.logoUrl
          : current.logoUrl,
    reportTitle: patch.reportTitle === undefined ? current.reportTitle : patch.reportTitle,
    footerText: patch.footerText === undefined ? current.footerText : patch.footerText,
  };

  await prisma.agency.update({
    where: { id: agencyId },
    data: { branding: JSON.stringify(next) },
  });
  return next;
}

export interface AgencyOverview {
  agencyName: string;
  branding: Branding;
  clients: Array<{
    id: string;
    name: string;
    domain: string | null;
    projectCount: number;
    keywordCount: number;
  }>;
  totals: { clients: number; projects: number; keywords: number };
}

/** Roster for the client switcher and the agency dashboard. */
export async function getAgencyOverview(agencyId: string): Promise<AgencyOverview> {
  const agency = await prisma.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { name: true, branding: true },
  });

  const clients = await prisma.client.findMany({
    where: { agencyId },
    orderBy: { name: "asc" },
    include: {
      projects: {
        select: { id: true, _count: { select: { projectKeywords: true } } },
      },
    },
  });

  const rows = clients.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    projectCount: c.projects.length,
    keywordCount: c.projects.reduce((n, p) => n + p._count.projectKeywords, 0),
  }));

  return {
    agencyName: agency.name,
    branding: parseBranding(agency.branding),
    clients: rows,
    totals: {
      clients: rows.length,
      projects: rows.reduce((n, c) => n + c.projectCount, 0),
      keywords: rows.reduce((n, c) => n + c.keywordCount, 0),
    },
  };
}
