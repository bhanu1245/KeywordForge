/**
 * Optional Claude-powered layer (PRD §9, "AI layer").
 *
 * NOTE ON SCOPE: content briefs sit in Phase 2 of PRD §7 but are listed as
 * core MVP flow 3 in PRD §8. Resolved in favour of §8 — the brief is what
 * makes a cluster actionable, and without it "Cluster -> Brief" is a dead end.
 *
 * Every function here has a deterministic non-AI fallback. That is not a
 * degraded mode bolted on afterwards: it means the product works with no
 * ANTHROPIC_API_KEY, costs nothing to demo, and stays testable. Claude
 * improves the prose; it is not load-bearing for the feature to function.
 */

import Anthropic from "@anthropic-ai/sdk";
import { classifyIntent, type Intent } from "../seo/intent";
import { groupQuestionsByType, isQuestion } from "../seo/questions";

export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

function model(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
}

export interface BriefKeyword {
  text: string;
  volume?: number | null;
  difficulty?: number | null;
}

export interface ContentBriefPayload {
  title: string;
  targetKeyword: string;
  intent: Intent;
  summary: string;
  headings: Array<{ level: 2 | 3; text: string }>;
  questionsToAnswer: string[];
  secondaryKeywords: string[];
  wordCountTarget: number;
  generatedBy: "claude" | "heuristic";
}

/**
 * Fallback brief built purely from cluster data. Genuinely useful on its own:
 * the questions come from real question keywords in the cluster, and the
 * headings are derived from the highest-volume secondary terms.
 */
export function buildHeuristicBrief(
  clusterName: string,
  keywords: BriefKeyword[],
): ContentBriefPayload {
  const sorted = [...keywords].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const target = sorted[0]?.text ?? clusterName;
  const intent = classifyIntent(target).intent;

  const questions = sorted.map((k) => k.text).filter((t) => isQuestion(t));
  const nonQuestions = sorted.map((k) => k.text).filter((t) => !isQuestion(t) && t !== target);

  const headings: Array<{ level: 2 | 3; text: string }> = [];
  headings.push({ level: 2, text: `What is ${target}?` });
  for (const term of nonQuestions.slice(0, 6)) {
    // Title-case the secondary term so it reads as a heading, not a query.
    headings.push({
      level: 2,
      text: term.replace(/\b\w/g, (c) => c.toUpperCase()),
    });
  }
  if (questions.length > 0) headings.push({ level: 2, text: "Frequently Asked Questions" });
  for (const q of questions.slice(0, 5)) {
    headings.push({ level: 3, text: q.replace(/\b\w/g, (c) => c.toUpperCase()) });
  }

  const totalVolume = keywords.reduce((sum, k) => sum + (k.volume ?? 0), 0);
  // Rough: more sub-topics to cover means a longer page. Bounded so the
  // number stays a sane brief target rather than an arbitrary huge figure.
  const wordCountTarget = Math.min(
    3000,
    Math.max(800, 400 + keywords.length * 60),
  );

  return {
    title: `Content brief: ${target}`,
    targetKeyword: target,
    intent,
    summary:
      `Covers ${keywords.length} related keywords with a combined ${totalVolume.toLocaleString()} monthly searches. ` +
      `Primary intent is ${intent}. Structure the page around "${target}" and answer the clustered questions on the same URL to avoid splitting authority.`,
    headings,
    questionsToAnswer: questions.slice(0, 10),
    secondaryKeywords: nonQuestions.slice(0, 15),
    wordCountTarget,
    generatedBy: "heuristic",
  };
}

const BRIEF_SYSTEM_PROMPT = `You are an SEO content strategist producing a content brief for an agency.
Return ONLY valid JSON matching this shape, with no markdown fence and no commentary:
{
  "title": string,
  "targetKeyword": string,
  "summary": string,
  "headings": [{"level": 2 | 3, "text": string}],
  "questionsToAnswer": string[],
  "secondaryKeywords": string[],
  "wordCountTarget": number
}
Rules:
- Build ONE page that covers the whole cluster; do not suggest splitting it.
- Headings must be human page headings, not search queries.
- Only use keywords supplied in the input; do not invent new ones.
- wordCountTarget must be an integer between 600 and 3500.`;

/**
 * Claude-generated brief, with the heuristic version returned on any failure —
 * a rate limit or a malformed response must never leave the user with nothing.
 */
export async function generateContentBrief(
  clusterName: string,
  keywords: BriefKeyword[],
): Promise<ContentBriefPayload> {
  const fallback = buildHeuristicBrief(clusterName, keywords);
  if (!isAiEnabled() || keywords.length === 0) return fallback;

  const questionGroups = groupQuestionsByType(keywords.map((k) => k.text));

  const input = {
    cluster: clusterName,
    primaryIntent: fallback.intent,
    keywords: keywords
      .slice(0, 120)
      .map((k) => ({ keyword: k.text, volume: k.volume ?? 0, difficulty: k.difficulty ?? null })),
    questionsByType: questionGroups,
  };

  try {
    const response = await client().messages.create({
      model: model(),
      max_tokens: 2000,
      system: BRIEF_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    // Models occasionally wrap JSON in a fence despite instructions.
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonText) as Partial<ContentBriefPayload>;

    if (!parsed.title || !Array.isArray(parsed.headings)) return fallback;

    return {
      title: parsed.title,
      targetKeyword: parsed.targetKeyword || fallback.targetKeyword,
      intent: fallback.intent,
      summary: parsed.summary || fallback.summary,
      headings: parsed.headings.filter(
        (h) => h && (h.level === 2 || h.level === 3) && typeof h.text === "string",
      ),
      questionsToAnswer: Array.isArray(parsed.questionsToAnswer)
        ? parsed.questionsToAnswer
        : fallback.questionsToAnswer,
      secondaryKeywords: Array.isArray(parsed.secondaryKeywords)
        ? parsed.secondaryKeywords
        : fallback.secondaryKeywords,
      wordCountTarget:
        typeof parsed.wordCountTarget === "number"
          ? parsed.wordCountTarget
          : fallback.wordCountTarget,
      generatedBy: "claude",
    };
  } catch (error) {
    console.warn("[ai] brief generation failed, using heuristic brief:", error);
    return fallback;
  }
}
