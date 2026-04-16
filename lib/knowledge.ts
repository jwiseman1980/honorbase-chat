// lib/knowledge.ts
// Phase 2: Knowledge base check (before model calls) and artifact saving (after responses).
// Phase 3 will replace keyword matching with pgvector semantic search.

import { getClient } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

const haiku = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Keyword extraction ────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","up","about","into","through","is","are","was","were","be",
  "been","being","have","has","had","do","does","did","will","would","could",
  "should","may","might","shall","can","need","it","its","i","you","he","she",
  "we","they","what","which","who","this","that","these","those","my","your",
  "his","her","our","their","me","him","us","them","not","no","so","if","as",
  "how","when","where","why","just","also","then","than","too","very","some",
  "any","all","get","got","let","make","know","go","see","use","like","want",
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, 15);
}

export function extractDomainTags(text: string): string[] {
  return extractKeywords(text).slice(0, 8);
}

// ── Knowledge base check ──────────────────────────────────────────────────────

export type KBResult = {
  hit: boolean;
  confidence: number;
  artifact?: { id: string; answer_body: string; answer_summary: string };
  source?: "org" | "platform";
};

export async function checkKnowledgeBase(
  orgId: string,
  userMessage: string
): Promise<KBResult> {
  const noHit: KBResult = { hit: false, confidence: 0 };

  try {
    const sb = getClient();
    if (!sb) return noHit;

    const keywords = extractKeywords(userMessage);
    if (keywords.length === 0) return noHit;

    // 1. Query org artifacts — fetch top candidates by reuse_count for speed
    const { data: orgArtifacts } = await sb
      .from("org_knowledge_artifacts")
      .select("id, query_pattern, answer_summary, answer_body, domain_tags, reuse_count")
      .eq("org_id", orgId)
      .order("reuse_count", { ascending: false })
      .limit(30);

    const orgHit = scoreArtifacts(orgArtifacts || [], keywords);
    if (orgHit && orgHit.score > 0.6) {
      await bumpReuse("org_knowledge_artifacts", orgHit.id, sb);
      return {
        hit: true,
        confidence: orgHit.score,
        artifact: { id: orgHit.id, answer_body: orgHit.answer_body, answer_summary: orgHit.answer_summary },
        source: "org",
      };
    }

    // 2. Fall back to platform pool
    const { data: poolArtifacts } = await sb
      .from("platform_knowledge_pool")
      .select("id, query_pattern, answer_template, domain_tags, reuse_count")
      .order("reuse_count", { ascending: false })
      .limit(30);

    if (!poolArtifacts || poolArtifacts.length === 0) return noHit;

    const poolHit = scoreArtifacts(
      poolArtifacts.map((p) => ({
        ...p,
        answer_body: p.answer_template,
        answer_summary: p.query_pattern,
      })),
      keywords
    );

    if (poolHit && poolHit.score > 0.6) {
      await bumpReuse("platform_knowledge_pool", poolHit.id, sb);
      return {
        hit: true,
        confidence: poolHit.score,
        artifact: { id: poolHit.id, answer_body: poolHit.answer_body, answer_summary: poolHit.answer_summary },
        source: "platform",
      };
    }

    return noHit;
  } catch {
    return noHit;
  }
}

type ArtifactCandidate = {
  id: string;
  query_pattern: string;
  answer_summary: string;
  answer_body: string;
  domain_tags: string[];
  reuse_count: number;
};

type ScoredHit = ArtifactCandidate & { score: number };

function scoreArtifacts(
  artifacts: ArtifactCandidate[],
  keywords: string[]
): ScoredHit | null {
  let best: ScoredHit | null = null;

  for (const artifact of artifacts) {
    const tagSet = new Set((artifact.domain_tags || []).map((t) => t.toLowerCase()));
    const queryWords = extractKeywords(artifact.query_pattern || "");
    const summaryWords = extractKeywords(artifact.answer_summary || "");
    const candidateTokens = new Set([...tagSet, ...queryWords, ...summaryWords]);

    const overlap = keywords.filter((k) => candidateTokens.has(k)).length;
    const score = overlap / Math.max(keywords.length, candidateTokens.size, 1);

    if (score > (best?.score ?? 0)) {
      best = { ...artifact, score };
    }
  }

  return best;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bumpReuse(table: string, id: string, sb: any): Promise<void> {
  try {
    await sb
      .from(table)
      .update({ reuse_count: sb.rpc("increment"), last_reused_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    // Best-effort — don't fail the whole request if this update fails.
    // Use a raw increment instead since rpc("increment") is a convenience that may not exist.
    try {
      const { data } = await sb.from(table).select("reuse_count").eq("id", id).single();
      if (data) {
        await sb
          .from(table)
          .update({ reuse_count: (data.reuse_count || 0) + 1, last_reused_at: new Date().toISOString() })
          .eq("id", id);
      }
    } catch {
      // silent
    }
  }
}

// ── Auto-save knowledge artifacts ─────────────────────────────────────────────

const ORG_SPECIFIC_PATTERNS = [
  /steel.?hearts/i,
  /drmf/i,
  /drew.?ross/i,
  /kristin/i,
  /joseph/i,
  /wiseman/i,
  /steel-hearts/i,
];

export async function saveKnowledgeArtifact(
  orgId: string,
  params: {
    userMessage: string;
    assistantResponse: string;
    modelUsed: string;
    domainTags?: string[];
  }
): Promise<void> {
  const { userMessage, assistantResponse, modelUsed, domainTags } = params;

  // Only save substantive Sonnet/Opus responses
  if (modelUsed === "haiku" || modelUsed === "claude-haiku-4-5-20251001") return;
  if (assistantResponse.length < 200) return;

  // Skip simple acknowledgments
  const trimmed = assistantResponse.trim().toLowerCase();
  if (
    trimmed.startsWith("sure") ||
    trimmed.startsWith("ok") ||
    trimmed.startsWith("got it") ||
    trimmed.startsWith("understood")
  ) {
    if (assistantResponse.length < 400) return;
  }

  try {
    const sb = getClient();
    if (!sb) return;

    // Generate summary via Haiku (cheap)
    const summaryResp = await haiku.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content: `Summarize this nonprofit assistant answer in ONE line (max 100 chars). Return only the summary, no quotes.

Question: ${userMessage.slice(0, 300)}
Answer: ${assistantResponse.slice(0, 600)}`,
        },
      ],
    });

    const summary =
      summaryResp.content[0].type === "text"
        ? summaryResp.content[0].text.trim().slice(0, 120)
        : userMessage.slice(0, 120);

    // Determine generalizability
    const isOrgSpecific = ORG_SPECIFIC_PATTERNS.some(
      (p) => p.test(assistantResponse) || p.test(userMessage)
    );
    const isGeneralizable = !isOrgSpecific && assistantResponse.length > 400;

    const normalizedModel = modelUsed.includes("opus") ? "opus" : "sonnet";
    const tags = domainTags || extractDomainTags(userMessage);

    // Insert artifact
    const { data: inserted } = await sb
      .from("org_knowledge_artifacts")
      .insert({
        org_id: orgId,
        query_pattern: userMessage.slice(0, 500),
        answer_summary: summary,
        answer_body: assistantResponse,
        model_used: normalizedModel,
        domain_tags: tags,
        is_org_specific: isOrgSpecific,
        is_generalizable: isGeneralizable,
      })
      .select("id")
      .single();

    // If generalizable, add to platform pool (anonymized)
    if (isGeneralizable && inserted?.id) {
      await sb.from("platform_knowledge_pool").insert({
        source_artifact_id: inserted.id,
        domain_tags: tags,
        query_pattern: userMessage.slice(0, 500),
        answer_template: assistantResponse,
        applicability_filter: {},
      });
    }
  } catch {
    // silent — never block the response
  }
}
