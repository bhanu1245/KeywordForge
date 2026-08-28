/**
 * Keyword Alerts (PRD §7 module 29, §10 `alerts`).
 *
 * Alerts are evaluated when a rank check completes rather than on a separate
 * timer. That is deliberate: an alert about a rank change can only be as fresh
 * as the rank data behind it, so a schedule of its own would either duplicate
 * the SERP cost or fire on stale numbers.
 *
 * Fired events are STORED, not only dispatched. The workspace needs to answer
 * "what changed since I last looked" without depending on an email arriving,
 * and an event log is also what makes the rules debuggable.
 */

import { prisma } from "../db";
import { normaliseDomain } from "../competitors/service";

export const ALERT_TYPES = [
  "rank_drop",
  "rank_gain",
  "lost_ranking",
  "new_competitor",
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_LABELS: Record<AlertType, string> = {
  rank_drop: "Rank drop",
  rank_gain: "Rank gain",
  lost_ranking: "Fell out of top 10",
  new_competitor: "New competitor appeared",
};

export interface EvaluateResult {
  evaluated: number;
  fired: number;
}

/**
 * Runs every enabled alert for a project against the two most recent rank
 * checks. Returns how many fired.
 */
export async function evaluateAlerts(
  projectId: string,
  ownDomain: string | null,
): Promise<EvaluateResult> {
  const alerts = await prisma.alert.findMany({ where: { projectId, enabled: true } });
  if (alerts.length === 0 || !ownDomain) return { evaluated: alerts.length, fired: 0 };

  const domain = normaliseDomain(ownDomain);
  const entries = await prisma.rankTrackingEntry.findMany({
    where: { projectId, domain },
    orderBy: { checkedAt: "desc" },
    include: { keyword: true },
  });

  // Group newest-first per keyword; index 0 is current, 1 is previous.
  const byKeyword = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byKeyword.get(e.keywordId);
    if (list) list.push(e);
    else byKeyword.set(e.keywordId, [e]);
  }

  const events: Array<{
    alertId: string;
    keywordId: string;
    message: string;
    detail: string;
  }> = [];

  for (const alert of alerts) {
    for (const [keywordId, list] of byKeyword) {
      const current = list[0];
      const previous = list[1];
      // Nothing to compare against on the very first check.
      if (!previous) continue;

      const now = current.position;
      const before = previous.position;
      const text = current.keyword.text;

      if (alert.type === "rank_drop") {
        if (now !== null && before !== null && now - before >= alert.threshold) {
          events.push({
            alertId: alert.id,
            keywordId,
            message: `"${text}" dropped ${now - before} positions (#${before} → #${now})`,
            detail: JSON.stringify({ before, now }),
          });
        }
      }

      if (alert.type === "rank_gain") {
        if (now !== null && before !== null && before - now >= alert.threshold) {
          events.push({
            alertId: alert.id,
            keywordId,
            message: `"${text}" gained ${before - now} positions (#${before} → #${now})`,
            detail: JSON.stringify({ before, now }),
          });
        }
      }

      if (alert.type === "lost_ranking") {
        // Either fell out of the results entirely, or out of the top 10 —
        // both are "we stopped getting clicks", which is the thing worth
        // waking someone up for.
        const wasVisible = before !== null && before <= 10;
        const isGone = now === null || now > 10;
        if (wasVisible && isGone) {
          events.push({
            alertId: alert.id,
            keywordId,
            message:
              now === null
                ? `"${text}" fell out of the tracked results (was #${before})`
                : `"${text}" fell out of the top 10 (#${before} → #${now})`,
            detail: JSON.stringify({ before, now }),
          });
        }
      }
    }

    if (alert.type === "new_competitor") {
      // A domain now in the top 10 that holds no rank history of its own.
      const rankings = await prisma.serpRanking.findMany({
        where: { keyword: { projectLinks: { some: { projectId } } }, position: { lte: 10 } },
        select: { domain: true, keywordId: true },
      });
      const seen = await prisma.alertEvent.findMany({
        where: { alertId: alert.id },
        select: { detail: true },
      });
      const known = new Set(
        seen.flatMap((s) => {
          try {
            return [(JSON.parse(s.detail ?? "{}") as { domain?: string }).domain ?? ""];
          } catch {
            return [];
          }
        }),
      );

      const counts = new Map<string, number>();
      for (const r of rankings) {
        if (r.domain === domain) continue;
        counts.set(r.domain, (counts.get(r.domain) ?? 0) + 1);
      }
      for (const [competitor, count] of counts) {
        if (count < alert.threshold || known.has(competitor)) continue;
        events.push({
          alertId: alert.id,
          keywordId: "",
          message: `${competitor} now ranks in the top 10 for ${count} of your keywords`,
          detail: JSON.stringify({ domain: competitor, count }),
        });
      }
    }
  }

  if (events.length > 0) {
    await prisma.alertEvent.createMany({
      data: events.map((e) => ({
        alertId: e.alertId,
        keywordId: e.keywordId || null,
        message: e.message,
        detail: e.detail,
      })),
    });
  }

  return { evaluated: alerts.length, fired: events.length };
}

export async function listAlerts(projectId: string) {
  const alerts = await prisma.alert.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { events: true } },
    },
  });

  return alerts.map((a) => ({
    id: a.id,
    type: a.type,
    label: ALERT_LABELS[a.type as AlertType] ?? a.type,
    threshold: a.threshold,
    enabled: a.enabled,
    eventCount: a._count.events,
    unacknowledged: a.events.filter((e) => !e.acknowledged).length,
    events: a.events.map((e) => ({
      id: e.id,
      message: e.message,
      acknowledged: e.acknowledged,
      createdAt: e.createdAt.toISOString(),
    })),
  }));
}

export async function createAlert(
  projectId: string,
  type: AlertType,
  threshold: number,
) {
  const existing = await prisma.alert.findFirst({ where: { projectId, type } });
  if (existing) {
    return prisma.alert.update({
      where: { id: existing.id },
      data: { threshold, enabled: true },
    });
  }
  return prisma.alert.create({ data: { projectId, type, threshold } });
}

export async function setAlertEnabled(projectId: string, alertId: string, enabled: boolean) {
  await prisma.alert.updateMany({ where: { id: alertId, projectId }, data: { enabled } });
}

export async function acknowledgeEvents(projectId: string, alertId: string) {
  // Scoped through the alert's project so one tenant cannot clear another's.
  const alert = await prisma.alert.findFirst({ where: { id: alertId, projectId } });
  if (!alert) return;
  await prisma.alertEvent.updateMany({
    where: { alertId: alert.id },
    data: { acknowledged: true },
  });
}
