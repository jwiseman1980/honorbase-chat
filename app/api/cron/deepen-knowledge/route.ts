// app/api/cron/deepen-knowledge/route.ts
// Daily knowledge synthesis cron — runs at 03:00 UTC via Vercel Cron.
//
// For each org:
//   1. Read last 7 days of org_stream entries
//   2. Read org's current knowledge_files entry
//   3. Call Sonnet to synthesize patterns, new insights, and capability suggestions
//   4. Update knowledge_files with synthesized content
//   5. Emit 'insight' stream entries for notable patterns
//   6. Emit 'system_event' stream entries for capability suggestions

import Anthropic from "@anthropic-ai/sdk";
import { getClient, insertStream } from "@/lib/supabase";
import { getAllOrgs } from "@/config/orgs/index.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Vercel function timeout budget — 30s per org max.
const ORG_TIMEOUT_MS = 30_000;

export async function GET(req: Request) {
  // Vercel cron auth
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgs = getAllOrgs() as Array<{ orgId: string; orgName?: string }>;

  // Process orgs in parallel (each self-limited to ORG_TIMEOUT_MS)
  const results = await Promise.allSettled(
    orgs.map((org) =>
      Promise.race([
        deepenOrgKnowledge(org.orgId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), ORG_TIMEOUT_MS)
        ),
      ])
    )
  );

  const summary = results.map((r, i) => ({
    orgId: orgs[i].orgId,
    status: r.status,
    reason: r.status === "rejected" ? String(r.reason) : undefined,
  }));

  console.log("[deepen-knowledge] completed", summary);

  return Response.json({ processed: orgs.length, results: summary });
}

async function deepenOrgKnowledge(orgId: string): Promise<void> {
  const sb = getClient();
  if (!sb) return;

  // 1. Fetch last 7 days of stream entries
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentEntries } = await sb
    .from("org_stream")
    .select("stream_type, title, body, metadata, tags, importance, created_at")
    .eq("org_id", orgId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!recentEntries || recentEntries.length === 0) return;

  // 2. Fetch current knowledge_files entry (graceful: table may not exist yet)
  let currentKnowledge = "";
  let knowledgeFileId: string | null = null;
  try {
    const { data: kfRows } = await sb
      .from("knowledge_files")
      .select("id, content")
      .eq("org_id", orgId)
      .limit(1);
    if (kfRows && kfRows.length > 0) {
      currentKnowledge = (kfRows[0].content as string) || "";
      knowledgeFileId = kfRows[0].id as string;
    }
  } catch {
    // knowledge_files table may not exist — proceed without it
  }

  // 3. Build stream digest
  const streamDigest = recentEntries
    .map(
      (e) =>
        `[${e.stream_type}] ${String(e.created_at).slice(0, 10)}: ${e.title}${
          e.body ? ` — ${String(e.body).slice(0, 100)}` : ""
        }`
    )
    .join("\n");

  // 4. Synthesize with Sonnet
  const synthesis = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are the HonorBase knowledge synthesizer. Analyze this nonprofit org's recent activity and update their operational context.

ORG ID: ${orgId}

CURRENT KNOWLEDGE FILE (may be empty for new orgs):
${currentKnowledge.slice(0, 3000) || "(empty — new org)"}

RECENT STREAM (last 7 days, ${recentEntries.length} entries):
${streamDigest}

Produce a JSON response with exactly these keys:
1. "knowledge_update": Updated knowledge file content (full rewrite OK). Include: recurring themes, active priorities, known workflows, the ED's working style as observed, and domains they operate in. Max 2000 chars. Markdown OK.
2. "new_capabilities": Array of 0-3 capability suggestions based on observed patterns. Each: {"capability": "string", "evidence": "why this was spotted", "priority": "low|medium|high"}
3. "insights": Array of 0-3 notable patterns. Each: {"pattern": "string", "evidence_count": number, "suggested_action": "string"}
4. "friction_summary": Top friction theme as a string if any patterns found, else null.

Return JSON only. No prose outside the JSON block.`,
      },
    ],
  });

  const raw =
    synthesis.content[0].type === "text" ? synthesis.content[0].text : "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return;

  let parsed: {
    knowledge_update?: string;
    new_capabilities?: Array<{ capability: string; evidence: string; priority: string }>;
    insights?: Array<{ pattern: string; evidence_count: number; suggested_action: string }>;
    friction_summary?: string | null;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return;
  }

  // 5. Update knowledge_files
  if (parsed.knowledge_update) {
    try {
      if (knowledgeFileId) {
        await sb
          .from("knowledge_files")
          .update({ content: parsed.knowledge_update, updated_at: new Date().toISOString() })
          .eq("id", knowledgeFileId);
      } else {
        await sb.from("knowledge_files").insert({
          org_id: orgId,
          content: parsed.knowledge_update,
          updated_at: new Date().toISOString(),
        });
      }
    } catch {
      // knowledge_files table may not exist — skip
    }
  }

  // 6. Emit insight stream entries
  for (const insight of parsed.insights || []) {
    await insertStream({
      org_id: orgId,
      stream_type: "insight",
      actor: "cron:deepen-knowledge",
      title: insight.pattern.slice(0, 120),
      body: `Suggested action: ${insight.suggested_action}`,
      metadata: {
        pattern: insight.pattern,
        evidence_count: insight.evidence_count,
        suggested_action: insight.suggested_action,
        confidence: insight.evidence_count > 5 ? 0.9 : 0.6,
      },
      tags: ["insight", "auto-generated"],
      importance: "medium",
    });
  }

  // 7. Emit capability suggestion entries
  for (const cap of parsed.new_capabilities || []) {
    await insertStream({
      org_id: orgId,
      stream_type: "system_event",
      actor: "cron:deepen-knowledge",
      title: `Capability opportunity: ${cap.capability}`.slice(0, 120),
      body: `Evidence: ${cap.evidence}`,
      metadata: {
        event_name: "capability_suggestion",
        capability_suggestion: cap.capability,
        evidence: cap.evidence,
        operator_id: "system",
        suggested_action: `Enable or build: ${cap.capability}`,
        confidence: cap.priority === "high" ? 0.85 : 0.6,
      },
      tags: ["capability", "suggestion", cap.priority],
      importance: cap.priority === "high" ? "high" : "medium",
    });
  }

  // 8. Emit friction summary if present
  if (parsed.friction_summary) {
    await insertStream({
      org_id: orgId,
      stream_type: "insight",
      actor: "cron:deepen-knowledge",
      title: `Friction theme: ${parsed.friction_summary}`.slice(0, 120),
      metadata: {
        pattern: "friction_summary",
        friction_summary: parsed.friction_summary,
        evidence_count: 1,
        suggested_action: "Review friction entries and improve knowledge base coverage",
        confidence: 0.7,
      },
      tags: ["insight", "friction", "auto-generated"],
      importance: "medium",
    });
  }
}
