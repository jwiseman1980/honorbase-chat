# HonorBase Unified Activity Stream — Architecture

**Status:** Design doc — not yet implemented  
**Supabase project:** `esoogmdwzcarvlodwbue` (Project A, "Steel Hearts" in dashboard)  
**Last updated:** 2026-04-16

---

## The Core Idea

Every interaction the ED has with their org's agent produces signal. Right now that signal evaporates. This architecture captures it all in a single chronological table per org, then mines it to discover what the org needs next. Day 1: the ED asks about planning a race. Day 90: HonorBase is running their compliance calendar because it observed what they kept forgetting.

The stream is not a log. It is the org's operational memory — externalized, queryable, and trainable.

---

## 1. `org_stream` Table

### 1.1 DDL

```sql
-- Migration: 003_org_stream.sql
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql

CREATE TYPE public.stream_type_enum AS ENUM (
  'chat_turn',          -- every completed assistant turn (summarized, not raw)
  'decision',           -- a decision was logged or referenced
  'friction',           -- ED expressed frustration, confusion, or repeated a question
  'task_created',       -- a task was created via chat or API
  'task_updated',       -- a task changed status
  'task_completed',     -- a task was marked done
  'email_sent',         -- system drafted or sent an outbound email
  'email_received',     -- inbound email of significance noted
  'order_fulfilled',    -- Squarespace order synced and processed
  'donation_received',  -- donation arrived (webhook or sync)
  'volunteer_action',   -- volunteer sign-up, check-in, or hours logged
  'compliance_event',   -- deadline approaching, met, or missed
  'social_post',        -- social content drafted or published
  'cron_outcome',       -- scheduled job completed (success or failure)
  'insight',            -- synthesized pattern from the knowledge deepening loop
  'context_note',       -- freeform context the agent or operator wanted to pin
  'system_event'        -- platform-level event (operator injection, feature flag, nudge)
);

CREATE TABLE IF NOT EXISTS public.org_stream (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         TEXT        NOT NULL,
  stream_type    public.stream_type_enum NOT NULL,
  actor          TEXT        NOT NULL DEFAULT 'system',
  -- 'system', 'claude', 'cron:<job_name>', or the ED's name/email
  title          TEXT        NOT NULL,           -- one-line summary, always present
  body           TEXT,                           -- markdown narrative, optional
  metadata       JSONB       NOT NULL DEFAULT '{}',
  -- stream_type-specific structured data (see §1.2)
  related_table  TEXT,                           -- e.g. 'tasks', 'decisions', 'orders'
  related_id     UUID,                           -- FK to the related record
  tags           TEXT[]      NOT NULL DEFAULT '{}',
  importance     TEXT        NOT NULL DEFAULT 'medium'
                 CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  session_id     TEXT,       -- optional: links to chat session that generated this
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query pattern: per-org reverse-chronological feed
CREATE INDEX idx_org_stream_org_time
  ON public.org_stream (org_id, created_at DESC);

-- Filter by type within an org
CREATE INDEX idx_org_stream_org_type
  ON public.org_stream (org_id, stream_type, created_at DESC);

-- Cross-reference lookups (operator linking a stream entry to a source record)
CREATE INDEX idx_org_stream_related
  ON public.org_stream (related_table, related_id)
  WHERE related_table IS NOT NULL;

-- Importance filter (operator friction/critical dashboard)
CREATE INDEX idx_org_stream_importance
  ON public.org_stream (org_id, importance, created_at DESC)
  WHERE importance IN ('high', 'critical');

-- Tag search
CREATE INDEX idx_org_stream_tags
  ON public.org_stream USING GIN (tags);

-- JSONB metadata search
CREATE INDEX idx_org_stream_metadata
  ON public.org_stream USING GIN (metadata);

ALTER TABLE public.org_stream ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_org_stream"
  ON public.org_stream FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Operator view: anon/authenticated reads are blocked; all writes go through service_role
-- This is intentional. Org agents never read their own stream directly (they use knowledge_files).
-- The stream is a write-only surface for agents; read surface for the operator dashboard.
```

### 1.2 Metadata Shapes by `stream_type`

These are contracts, not enforced by the DB — validation lives in `lib/stream.ts`.

| `stream_type` | Required metadata keys | Optional |
|---|---|---|
| `chat_turn` | `topics: string[]`, `tools_used: string[]`, `turn_index: number` | `decision_made: bool`, `action_items: string[]` |
| `decision` | `domain: string`, `decision_text: string` | `reversible: bool`, `reviewed_by: string` |
| `friction` | `trigger: string` (what triggered detection), `signal: string[]` | `question_repeated: bool`, `prior_turn_id: uuid` |
| `task_created` | `task_title: string`, `priority: string` | `due_date: string`, `assigned_to: string` |
| `task_completed` | `task_title: string`, `duration_days: number` | `completed_by: string` |
| `email_sent` | `recipient: string`, `subject: string`, `template: string` | `org_contact_id: uuid` |
| `order_fulfilled` | `order_id: string`, `hero_name: string`, `item_count: number`, `amount_cents: number` | `fulfillment_type: string` |
| `donation_received` | `amount_cents: number`, `donor_name: string`, `platform: string` | `campaign: string`, `recurring: bool` |
| `compliance_event` | `deadline_name: string`, `due_date: string`, `status: string` | `filing_type: string`, `days_remaining: number` |
| `cron_outcome` | `job_name: string`, `success: bool`, `duration_ms: number` | `records_processed: number`, `error_summary: string` |
| `insight` | `pattern: string`, `evidence_count: number`, `suggested_action: string` | `capability_suggestion: string`, `confidence: number` |
| `system_event` | `event_name: string`, `operator_id: string` | `message: string`, `action_url: string` |

---

## 2. Auto-Capture Hooks

### 2.1 Chat Turns (`stream_type: 'chat_turn'`)

**File:** [`app/api/chat/route.ts`](app/api/chat/route.ts)  
**Insertion point:** After line 624 (`const fullText = await runAgentLoop(...)`) and before line 637 (message persistence).

The hook calls a lightweight summarizer — a second Claude call with a compact prompt — to extract topics and decisions from the turn without logging raw tokens.

```typescript
// lib/stream.ts — new file

import { insertStream } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

const summarizer = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function captureChaTurn(
  orgId: string,
  userMessage: string,
  assistantResponse: string,
  toolsUsed: string[],
  turnIndex: number,
  sessionId?: string
): Promise<void> {
  // Don't await — fire-and-forget to keep response latency unaffected
  (async () => {
    try {
      const summary = await summarizer.messages.create({
        model: "claude-haiku-4-5-20251001", // Haiku for cost efficiency
        max_tokens: 256,
        messages: [{
          role: "user",
          content: `Summarize this nonprofit ED chat turn in ONE line (max 120 chars) and list up to 5 topic tags.

User: ${userMessage.slice(0, 800)}
Assistant: ${assistantResponse.slice(0, 1200)}

Respond with JSON only:
{"title": "one-line summary", "topics": ["tag1", "tag2"], "decision_made": false, "action_items": []}`
        }]
      });

      const raw = summary.content[0].type === "text" ? summary.content[0].text : "{}";
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");

      await insertStream({
        org_id: orgId,
        stream_type: "chat_turn",
        actor: "claude",
        title: parsed.title || userMessage.slice(0, 120),
        metadata: {
          topics: parsed.topics || [],
          tools_used: toolsUsed,
          turn_index: turnIndex,
          decision_made: parsed.decision_made || false,
          action_items: parsed.action_items || [],
        },
        tags: parsed.topics || [],
        importance: parsed.decision_made ? "high" : "low",
        session_id: sessionId,
      });
    } catch {
      // silent — stream capture must never break the chat response
    }
  })();
}
```

**Hook insertion in `app/api/chat/route.ts`, after line 624:**

```typescript
// After: const fullText = await runAgentLoop(...)
// Add (line ~625):
import { captureChaTurn, captureFriction } from "@/lib/stream";

// Inside the stream start() callback, after runAgentLoop resolves:
const turnIndex = messages.length; // user messages before this turn
captureChaTurn(orgId, lastUserMsg?.content as string || "", fullText, toolsUsed, turnIndex);

// Friction detection runs on the same data (see §2.2)
captureFriction(orgId, messages, fullText, turnIndex);
```

### 2.2 Friction Detection (`stream_type: 'friction'`)

**File:** [`app/api/chat/route.ts`](app/api/chat/route.ts)  
**Insertion point:** Same as §2.1 — runs in parallel with chat turn capture, fire-and-forget.

**Detection heuristic (rule-based, no LLM cost):**

```typescript
// lib/stream.ts

const FRUSTRATION_SIGNALS = [
  /\b(frustrated?|annoyed?|confused?|lost|doesn't? work|not working|still not|broken|wrong|incorrect)\b/i,
  /\bwhy (isn't?|doesn't?|won't?|can't?)\b/i,
  /\b(ugh|argh|wtf|what the|forget it)\b/i,
  /\?{2,}/,            // multiple question marks
  /tried .{0,60} again/i,
  /same (question|thing|issue|problem)/i,
  /already (asked|told|said|mentioned)/i,
];

export async function captureFriction(
  orgId: string,
  priorMessages: IncomingMessage[],
  assistantResponse: string,
  turnIndex: number
): Promise<void> {
  const lastUser = priorMessages[priorMessages.length - 1];
  if (!lastUser) return;

  const userText = typeof lastUser.content === "string"
    ? lastUser.content
    : (lastUser.content as Array<{ text?: string }>)
        .filter(p => p.text).map(p => p.text).join(" ");

  const signals: string[] = [];

  for (const pattern of FRUSTRATION_SIGNALS) {
    if (pattern.test(userText)) signals.push(pattern.source);
  }

  // Repetition check: did the user ask a substantially similar question recently?
  if (turnIndex >= 4) {
    const recentUserMessages = priorMessages
      .filter(m => m.role === "user")
      .slice(-4)
      .map(m => (typeof m.content === "string" ? m.content : "").toLowerCase());

    const currentWords = new Set(userText.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const overlapCounts = recentUserMessages.slice(0, -1).map(prev => {
      const prevWords = prev.split(/\s+/).filter(w => w.length > 4);
      const overlap = prevWords.filter(w => currentWords.has(w)).length;
      return overlap / Math.max(currentWords.size, 1);
    });

    if (overlapCounts.some(r => r > 0.5)) {
      signals.push("repeated_question_detected");
    }
  }

  if (signals.length === 0) return;

  (async () => {
    try {
      await insertStream({
        org_id: orgId,
        stream_type: "friction",
        actor: "system",
        title: `Friction detected: ${userText.slice(0, 80)}`,
        body: `User message: ${userText.slice(0, 500)}`,
        metadata: {
          trigger: userText.slice(0, 200),
          signal: signals,
          question_repeated: signals.includes("repeated_question_detected"),
          turn_index: turnIndex,
        },
        tags: ["friction", "ux"],
        importance: signals.includes("repeated_question_detected") ? "high" : "medium",
      });
    } catch { /* silent */ }
  })();
}
```

### 2.3 Task Lifecycle (`stream_type: 'task_created' | 'task_updated' | 'task_completed'`)

Tasks in HonorBase are currently tracked via dashboard cards (type `list`) and build requests. Until a dedicated `tasks` table exists, stream entries are the canonical record.

**Hook location:** `app/api/dashboard/route.ts` POST handler and any future `app/api/tasks/route.ts`.

```typescript
// lib/stream.ts — add:
export async function captureTaskEvent(
  orgId: string,
  eventType: "task_created" | "task_updated" | "task_completed",
  task: { id: string; title: string; priority?: string; due_date?: string },
  completedAt?: string
): Promise<void> {
  const titleMap = {
    task_created: `Task created: ${task.title}`,
    task_updated: `Task updated: ${task.title}`,
    task_completed: `Task completed: ${task.title}`,
  };

  await insertStream({
    org_id: orgId,
    stream_type: eventType,
    actor: "system",
    title: titleMap[eventType],
    metadata: {
      task_title: task.title,
      priority: task.priority || "medium",
      due_date: task.due_date,
      ...(completedAt ? { duration_days: 0 } : {}), // calculate from task.created_at
    },
    related_table: "tasks",
    related_id: task.id as unknown as string, // UUID when tasks table exists
    tags: ["task", task.priority || "medium"],
    importance: task.priority === "critical" ? "critical"
               : task.priority === "high" ? "high" : "medium",
  });
}
```

**Hook insertion in `app/api/dashboard/route.ts`:**  
After any upsert that adds/modifies a `list` card with task-like items, call `captureTaskEvent`. When `task_completed` is detected (item `done: true` flipped), call with `task_completed`.

### 2.4 Email / Comms (`stream_type: 'email_sent'`)

**File:** `app/api/chat/route.ts` — the agent currently drafts emails but doesn't formally send them (drafts go to Claude's response text, Joseph reviews).

When a `send_email` tool is added (or the Gmail send action is enabled), the capture goes in `executeTool()` in `route.ts`, after the Gmail API call succeeds:

```typescript
// Inside executeTool(), after a successful gmail send:
import { captureEmailEvent } from "@/lib/stream";

await captureEmailEvent(orgId, {
  recipient: toAddress,
  subject,
  template: templateName || "ad_hoc",
});

// lib/stream.ts:
export async function captureEmailEvent(
  orgId: string,
  details: { recipient: string; subject: string; template: string }
): Promise<void> {
  await insertStream({
    org_id: orgId,
    stream_type: "email_sent",
    actor: "claude",
    title: `Email sent: "${details.subject}" → ${details.recipient}`,
    metadata: details,
    tags: ["email", "outreach"],
    importance: "medium",
  });
}
```

For inbound significance (Gmail tool reads an email that prompts action), the `captureChaTurn` hook picks this up via `tools_used: ['gmail']` and the summarized topics. Explicit `email_received` entries are written only when the agent explicitly notes an email as significant.

### 2.5 Orders / Donations

**Squarespace webhook handler:** Currently does not exist in honorbase-chat. When built at `app/api/webhooks/squarespace/route.ts`:

```typescript
// At the end of the POST handler, after order is processed:
await insertStream({
  org_id: orgId,
  stream_type: "order_fulfilled",
  actor: "system",
  title: `Order fulfilled: ${heroName} — ${itemCount} item(s) — $${(amountCents / 100).toFixed(2)}`,
  metadata: {
    order_id: orderId,
    hero_name: heroName,
    item_count: itemCount,
    amount_cents: amountCents,
  },
  related_table: "orders",
  tags: ["order", "squarespace"],
  importance: "medium",
});
```

**Donation webhook** (`app/api/webhooks/donation/route.ts`):

```typescript
await insertStream({
  org_id: orgId,
  stream_type: "donation_received",
  actor: "system",
  title: `Donation received: $${(amount / 100).toFixed(2)} from ${donorName}`,
  metadata: { amount_cents: amount, donor_name: donorName, platform, campaign, recurring },
  tags: ["donation", platform],
  importance: amount > 50000 ? "high" : "medium", // >$500 = high
});
```

### 2.6 Compliance Events

**Location:** `app/api/cron/compliance-check/route.ts` (new — see §2.7 for cron pattern).

Compliance deadlines are stored in the org's system prompt and/or a future `compliance_calendar` table. The cron reads upcoming deadlines and emits:

```typescript
// For each deadline within 30 days:
await insertStream({
  org_id: orgId,
  stream_type: "compliance_event",
  actor: "cron:compliance-check",
  title: `Compliance: ${deadlineName} due in ${daysRemaining} days`,
  metadata: {
    deadline_name: deadlineName,
    due_date: dueDate,
    status: "approaching",
    days_remaining: daysRemaining,
    filing_type: filingType,
  },
  tags: ["compliance", filingType],
  importance: daysRemaining <= 7 ? "critical" : daysRemaining <= 30 ? "high" : "medium",
});
```

### 2.7 Cron Job Outcomes (`stream_type: 'cron_outcome'`)

**Pattern:** Each cron route wraps its logic in a try/finally and logs to the stream on exit.

```typescript
// lib/stream.ts — utility wrapper:
export async function withCronCapture<T>(
  orgId: string,
  jobName: string,
  fn: () => Promise<{ recordsProcessed?: number; summary?: string; result: T }>
): Promise<T> {
  const start = Date.now();
  try {
    const { recordsProcessed, summary, result } = await fn();
    await insertStream({
      org_id: orgId,
      stream_type: "cron_outcome",
      actor: `cron:${jobName}`,
      title: `${jobName}: completed — ${summary || `${recordsProcessed ?? 0} records`}`,
      metadata: {
        job_name: jobName,
        success: true,
        duration_ms: Date.now() - start,
        records_processed: recordsProcessed ?? 0,
      },
      tags: ["cron", jobName],
      importance: "low",
    });
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await insertStream({
      org_id: orgId,
      stream_type: "cron_outcome",
      actor: `cron:${jobName}`,
      title: `${jobName}: FAILED — ${errorMsg.slice(0, 100)}`,
      metadata: {
        job_name: jobName,
        success: false,
        duration_ms: Date.now() - start,
        error_summary: errorMsg,
      },
      tags: ["cron", jobName, "error"],
      importance: "high",
    });
    throw err;
  }
}
```

Usage in any cron route:

```typescript
// app/api/cron/squarespace-sync/route.ts
export async function GET() {
  return withCronCapture("steel-hearts", "squarespace-sync", async () => {
    const orders = await syncSquarespaceOrders();
    return { recordsProcessed: orders.length, summary: `${orders.length} orders synced`, result: orders };
  });
}
```

---

## 3. Knowledge Deepening Loop

This is the `day 1 → day 90` engine. Runs daily per org. Takes stream → synthesizes → updates `knowledge_files` → emits insights.

### 3.1 Scheduled Route

**New file:** `app/api/cron/knowledge-deepen/route.ts`  
**Schedule:** Daily at 03:00 UTC (low-traffic). Set via Vercel Cron in `vercel.json`.

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/knowledge-deepen", "schedule": "0 3 * * *" }
  ]
}
```

### 3.2 Loop Logic

```typescript
// app/api/cron/knowledge-deepen/route.ts

import { getClient, insertStream } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";
import { getOrgById, getAllOrgs } from "@/config/orgs/index.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(req: Request) {
  // Vercel cron auth check
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgs = getAllOrgs(); // returns [{orgId, ...}, ...]
  const results = await Promise.allSettled(orgs.map(org => deepenOrgKnowledge(org.orgId)));

  return Response.json({
    processed: orgs.length,
    results: results.map((r, i) => ({
      orgId: orgs[i].orgId,
      status: r.status,
      reason: r.status === "rejected" ? String(r.reason) : undefined,
    })),
  });
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

  // 2. Fetch current knowledge_files entry for this org
  const { data: kfRows } = await sb
    .from("knowledge_files")
    .select("id, content")
    .eq("org_id", orgId)
    .limit(1);

  const currentKnowledge = kfRows?.[0]?.content || "";

  // 3. Build stream digest
  const streamDigest = recentEntries.map(e =>
    `[${e.stream_type}] ${e.created_at.slice(0, 10)}: ${e.title}${e.body ? ` — ${e.body.slice(0, 100)}` : ""}`
  ).join("\n");

  // 4. Synthesize with Claude Sonnet
  const synthesis = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `You are the HonorBase knowledge synthesizer. Analyze this org's recent activity and update their operational context.

ORG ID: ${orgId}

CURRENT KNOWLEDGE FILE (may be empty for new orgs):
${currentKnowledge.slice(0, 3000) || "(empty)"}

RECENT STREAM (last 7 days, ${recentEntries.length} entries):
${streamDigest}

Produce a JSON response with:
1. "knowledge_update": Updated knowledge file content (full rewrite is OK). Include: recurring themes, active priorities, known workflows, the ED's working style as observed, and domains they operate in. Max 2000 chars. Markdown OK.
2. "new_capabilities": Array of 0-3 capability suggestions based on patterns. Each: {"capability": "string", "evidence": "why this was spotted", "priority": "low|medium|high"}
3. "insights": Array of 0-3 notable patterns. Each: {"pattern": "string", "evidence_count": number, "suggested_action": "string"}
4. "friction_summary": Top friction themes if any, else null.

Return JSON only.`
    }]
  });

  const raw = synthesis.content[0].type === "text" ? synthesis.content[0].text : "{}";
  const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");

  // 5. Update knowledge_files
  if (parsed.knowledge_update) {
    await sb.from("knowledge_files").upsert({
      org_id: orgId,
      content: parsed.knowledge_update,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" });
  }

  // 6. Emit insight stream entries
  for (const insight of (parsed.insights || [])) {
    await insertStream({
      org_id: orgId,
      stream_type: "insight",
      actor: "system",
      title: insight.pattern,
      body: `Evidence count: ${insight.evidence_count}. Suggested action: ${insight.suggested_action}`,
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

  // 7. Emit capability suggestion entries (operator-visible)
  for (const cap of (parsed.new_capabilities || [])) {
    await insertStream({
      org_id: orgId,
      stream_type: "insight",
      actor: "system",
      title: `Capability opportunity: ${cap.capability}`,
      body: `Evidence: ${cap.evidence}`,
      metadata: {
        pattern: "capability_suggestion",
        capability_suggestion: cap.capability,
        evidence_count: 1,
        suggested_action: `Enable or build: ${cap.capability}`,
        confidence: cap.priority === "high" ? 0.85 : 0.6,
      },
      tags: ["insight", "capability", cap.priority],
      importance: cap.priority === "high" ? "high" : "medium",
    });
  }
}
```

### 3.3 The "Day 1 → Day 90" Progression

The knowledge file starts empty and grows through these synthesis passes:

| Days | `knowledge_files` depth | Capabilities emerging |
|---|---|---|
| 1–7 | ED name, org name, primary focus area | Basic Q&A, calendar reads |
| 8–30 | Active programs, recurring events, key contacts | Email drafting, task tracking |
| 31–60 | Seasonal patterns, donor segments, volunteer workflow | Automated outreach, compliance reminders |
| 61–90 | Board cadence, financial rhythm, grant cycle | Board reporting, donor stewardship, grant calendar |
| 90+ | Full operational model | Near-autonomous ED support |

The capability progression is not configured upfront — it emerges from what the org actually does, observed in the stream.

---

## 4. Operator View

### 4.1 Cross-Tenant Unified Feed

**New table:** `operator_stream_view` is a Postgres view, not a table. No data duplication.

```sql
-- Part of migration 003_org_stream.sql

CREATE VIEW public.operator_unified_feed AS
SELECT
  s.id,
  s.org_id,
  s.stream_type,
  s.actor,
  s.title,
  s.body,
  s.metadata,
  s.tags,
  s.importance,
  s.created_at,
  -- Enrichment: org display name from a config table (or hardcode for now)
  CASE s.org_id
    WHEN 'steel-hearts' THEN 'Steel Hearts Foundation'
    WHEN 'drmf' THEN 'Drew Ross Memorial Foundation'
    ELSE s.org_id
  END AS org_display_name
FROM public.org_stream s
ORDER BY s.created_at DESC;
```

**New file:** `app/api/operator/stream/route.ts`

```typescript
export async function GET(req: Request) {
  // Require superadmin session
  const session = await auth();
  if (session?.user?.role !== "superadmin") {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const orgId = url.searchParams.get("orgId");
  const type = url.searchParams.get("type");
  const importance = url.searchParams.get("importance");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);

  const sb = getClient()!;
  let query = sb
    .from("org_stream")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (orgId) query = query.eq("org_id", orgId);
  if (type) query = query.eq("stream_type", type);
  if (importance) query = query.eq("importance", importance);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req: Request) {
  // Operator injects a system_event into any org's stream
  const session = await auth();
  if (session?.user?.role !== "superadmin") {
    return new Response("Forbidden", { status: 403 });
  }

  const { orgId, title, body, tags } = await req.json();
  await insertStream({
    org_id: orgId,
    stream_type: "system_event",
    actor: `operator:${session.user.email}`,
    title,
    body,
    metadata: { event_name: "operator_injection", operator_id: session.user.email },
    tags: tags || ["operator"],
    importance: "medium",
  });

  return Response.json({ ok: true });
}
```

### 4.2 Friction Dashboard

**New route:** `app/api/operator/friction/route.ts`

```typescript
// Returns aggregated friction patterns across all orgs
export async function GET(req: Request) {
  const sb = getClient()!;

  // Friction entries in last 30 days, grouped by org
  const { data } = await sb
    .from("org_stream")
    .select("org_id, title, metadata, created_at")
    .eq("stream_type", "friction")
    .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
    .order("created_at", { ascending: false });

  // Client-side grouping (or use Postgres RPC for production)
  const byOrg = (data || []).reduce((acc, row) => {
    if (!acc[row.org_id]) acc[row.org_id] = { count: 0, repeated: 0, samples: [] };
    acc[row.org_id].count++;
    if (row.metadata?.question_repeated) acc[row.org_id].repeated++;
    if (acc[row.org_id].samples.length < 5) acc[row.org_id].samples.push(row.title);
    return acc;
  }, {} as Record<string, { count: number; repeated: number; samples: string[] }>);

  return Response.json(byOrg);
}
```

### 4.3 Growth Trajectory (per-org metrics)

```sql
-- Postgres RPC — add to migration 003 or a separate 004_operator_rpcs.sql

CREATE OR REPLACE FUNCTION public.org_growth_metrics(
  p_org_id TEXT,
  p_days    INT DEFAULT 30
)
RETURNS TABLE (
  week_start      DATE,
  entry_count     BIGINT,
  chat_turns      BIGINT,
  frictions       BIGINT,
  tasks_completed BIGINT,
  top_tags        TEXT[]
) LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc('week', created_at)::DATE AS week_start,
    COUNT(*) AS entry_count,
    COUNT(*) FILTER (WHERE stream_type = 'chat_turn') AS chat_turns,
    COUNT(*) FILTER (WHERE stream_type = 'friction') AS frictions,
    COUNT(*) FILTER (WHERE stream_type = 'task_completed') AS tasks_completed,
    ARRAY(
      SELECT unnest(tags)
      FROM org_stream sub
      WHERE sub.org_id = p_org_id
        AND sub.created_at >= now() - (p_days || ' days')::INTERVAL
      GROUP BY 1
      ORDER BY COUNT(*) DESC
      LIMIT 5
    ) AS top_tags
  FROM public.org_stream
  WHERE org_id = p_org_id
    AND created_at >= now() - (p_days || ' days')::INTERVAL
  GROUP BY week_start
  ORDER BY week_start;
$$;
```

**Call from operator dashboard:**

```typescript
const { data } = await sb.rpc("org_growth_metrics", { p_org_id: "steel-hearts", p_days: 90 });
```

---

## 5. Migration Plan

### 5.1 New File: `supabase/migrations/003_org_stream.sql`

Contains everything in §1.1 plus the operator view in §4.1 and the RPC in §4.3. Apply in Supabase SQL Editor at:  
`https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql`

Apply order:
1. `002_system_config.sql` (pending — must go first)
2. `003_org_stream.sql` (this doc)

### 5.2 Backfill Strategy

The stream won't be empty on launch because existing tables have historical data. Run this backfill SQL once after the table is created:

```sql
-- Backfill from hb_messages (chat history)
-- Creates one 'chat_turn' entry per assistant message
INSERT INTO public.org_stream (org_id, stream_type, actor, title, metadata, tags, importance, created_at)
SELECT
  org_id,
  'chat_turn',
  'claude',
  LEFT(
    CASE
      WHEN jsonb_typeof(content) = 'string' THEN content #>> '{}'
      ELSE content->0->>'text'
    END,
    120
  ) AS title,
  jsonb_build_object(
    'topics', '[]'::jsonb,
    'tools_used', '[]'::jsonb,
    'turn_index', 0,
    'decision_made', false,
    'backfilled', true
  ) AS metadata,
  ARRAY['chat_turn', 'backfilled'] AS tags,
  'low' AS importance,
  created_at
FROM public.hb_messages
WHERE role = 'assistant'
ON CONFLICT DO NOTHING;

-- Backfill from decisions table (if it exists in Project A)
INSERT INTO public.org_stream (org_id, stream_type, actor, title, metadata, tags, importance, created_at)
SELECT
  org_id,
  'decision',
  COALESCE(actor, 'system'),
  LEFT(COALESCE(title, decision_text, 'Decision recorded'), 120),
  jsonb_build_object(
    'domain', domain,
    'decision_text', decision_text,
    'backfilled', true
  ),
  ARRAY['decision', 'backfilled'],
  'medium',
  created_at
FROM public.decisions
ON CONFLICT DO NOTHING;

-- Backfill from friction_logs
INSERT INTO public.org_stream (org_id, stream_type, actor, title, metadata, tags, importance, created_at)
SELECT
  org_id,
  'friction',
  'system',
  LEFT(COALESCE(description, 'Friction observed'), 120),
  jsonb_build_object('trigger', description, 'signal', '[]'::jsonb, 'backfilled', true),
  ARRAY['friction', 'backfilled'],
  'medium',
  created_at
FROM public.friction_logs
ON CONFLICT DO NOTHING;

-- Backfill from execution_log
INSERT INTO public.org_stream (org_id, stream_type, actor, title, metadata, tags, importance, created_at)
SELECT
  org_id,
  'cron_outcome',
  COALESCE('cron:' || job_name, 'system'),
  LEFT(COALESCE(summary, 'Execution logged'), 120),
  jsonb_build_object('job_name', job_name, 'success', success, 'backfilled', true),
  ARRAY['cron', 'backfilled'],
  'low',
  created_at
FROM public.execution_log
ON CONFLICT DO NOTHING;
```

### 5.3 What Existing Tables Become

| Table | Fate | Reasoning |
|---|---|---|
| `hb_messages` | **Keep as primary write target** — stream is a parallel write, not a replacement | Full message content needed for chat history; stream holds summaries |
| `hb_dashboard_cards` | **Keep** — stream is additive, cards are UI state | Different purpose |
| `decisions` | **Keep + add stream writes** — decisions table is the permanent record, stream is the timeline | UNIQUE constraints and domain scoping only make sense in decisions |
| `context_log` | **Migrate to stream** — replace with `stream_type: 'context_note'` | One-to-one replacement |
| `friction_logs` | **Migrate to stream** — replace with `stream_type: 'friction'` | One-to-one replacement after backfill |
| `execution_log` | **Migrate to stream** — replace with `stream_type: 'cron_outcome'` | One-to-one replacement after backfill |
| `closeouts` | **Keep** — closeouts are a process queue, not a timeline entry | Different lifecycle semantics |
| `knowledge_files` | **Keep as write target for deepening loop** | Stream feeds into it; they're separate surfaces |

### 5.4 New `lib/supabase.ts` Functions

Add to [`lib/supabase.ts`](lib/supabase.ts) after line 96:

```typescript
// ── Activity stream ───────────────────────────────────────────────────────────

type StreamInsert = {
  org_id: string;
  stream_type: string;
  actor?: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  related_table?: string;
  related_id?: string;
  tags?: string[];
  importance?: string;
  session_id?: string;
};

export async function insertStream(entry: StreamInsert): Promise<void> {
  try {
    const sb = getClient();
    if (!sb) return;
    await sb.from("org_stream").insert({
      ...entry,
      actor: entry.actor || "system",
      metadata: entry.metadata || {},
      tags: entry.tags || [],
      importance: entry.importance || "medium",
    });
  } catch {
    // Stream failures must never surface to users
  }
}

export async function getRecentStream(
  orgId: string,
  limit = 50,
  type?: string
): Promise<StreamInsert[]> {
  try {
    const sb = getClient();
    if (!sb) return [];
    let q = sb
      .from("org_stream")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (type) q = q.eq("stream_type", type);
    const { data } = await q;
    return data || [];
  } catch {
    return [];
  }
}
```

---

## 6. The "Emergent Features" Pattern

This is not a recommendation engine. It is a capability-discovery system. The difference: a recommendation engine suggests features from a catalog. This system observes what the org is actually struggling with and infers what they need next.

### 6.1 Signal → Capability Mapping

The knowledge deepening loop (§3) already emits `insight` entries with `capability_suggestion` in metadata. Here is how signal patterns map to buildable capabilities:

| Stream signal pattern | Emergent capability |
|---|---|
| `chat_turn` topics include "volunteers" repeatedly (≥5 turns in 2 weeks) | Dashboard card: Volunteer tracker. Surface `volunteer_action` stream entries |
| `friction` entries cluster around "how do I find X" (≥3 times, same topic) | Add that topic as a `knowledge_files` domain entry; proactively surface it in system prompt |
| `compliance_event` entries exist but no `task_created` for the same deadline | Auto-create compliance tasks from detected deadlines |
| `chat_turn` topics include "email" + `email_sent` count is 0 | Offer to connect Gmail tool; ED is asking about emails but the tool isn't wired |
| `order_fulfilled` count ≥ 10 in 30 days | Dashboard card: Order metrics. Auto-aggregate volume, revenue, hero count |
| `donation_received` + chat topics include "thank" | Trigger: auto-generate donor thank-you email draft after each donation |
| Zero `chat_turn` entries for 5+ days | Friction: ED abandoned the tool. System event → operator dashboard alert |
| `cron_outcome` success rate < 80% for a job | High-importance operator alert: cron health degraded |

### 6.2 Capability Discovery Queries

```sql
-- Run periodically (or on-demand by operator) to find orgs ready for new capabilities

-- Orgs talking about volunteers but no volunteer tracking
SELECT org_id, COUNT(*) AS volunteer_mentions
FROM public.org_stream
WHERE stream_type = 'chat_turn'
  AND 'volunteer' = ANY(tags)
  AND created_at >= now() - interval '14 days'
GROUP BY org_id
HAVING COUNT(*) >= 5
  AND org_id NOT IN (
    SELECT DISTINCT org_id FROM public.org_stream WHERE stream_type = 'volunteer_action'
  );

-- Orgs with repeated friction on same topic
SELECT org_id, metadata->>'trigger' AS trigger_text, COUNT(*) AS frequency
FROM public.org_stream
WHERE stream_type = 'friction'
  AND created_at >= now() - interval '30 days'
GROUP BY org_id, metadata->>'trigger'
HAVING COUNT(*) >= 3
ORDER BY frequency DESC;

-- Orgs receiving donations but not sending thank-yous
SELECT d.org_id, COUNT(d.*) AS donations, COUNT(e.*) AS emails_sent
FROM public.org_stream d
LEFT JOIN public.org_stream e
  ON e.org_id = d.org_id
  AND e.stream_type = 'email_sent'
  AND e.created_at >= now() - interval '30 days'
WHERE d.stream_type = 'donation_received'
  AND d.created_at >= now() - interval '30 days'
GROUP BY d.org_id
HAVING COUNT(e.*) = 0;
```

### 6.3 Dashboard Card Auto-Suggestion

When the capability-discovery queries fire (called from the daily deepening cron), emit a `system_event` into the org's stream with `metadata.action: 'suggest_card'`:

```typescript
// lib/stream.ts
export async function suggestDashboardCard(
  orgId: string,
  cardConfig: { type: string; title: string; rationale: string }
): Promise<void> {
  await insertStream({
    org_id: orgId,
    stream_type: "system_event",
    actor: "system",
    title: `Capability suggestion: ${cardConfig.title}`,
    body: cardConfig.rationale,
    metadata: {
      event_name: "suggest_card",
      card_type: cardConfig.type,
      card_title: cardConfig.title,
      operator_id: "system",
    },
    tags: ["capability", "suggestion"],
    importance: "medium",
  });
}
```

The operator dashboard surfaces these as actionable nudges: one click to inject the card into the org's dashboard.

---

## 7. Prioritized Implementation Order

Build in this sequence. Each step delivers value independently; nothing requires the next step to function.

### Phase 1 — Foundation (1-2 days)
**Goal:** Stream table exists, chat turns are captured. This alone makes the operator dashboard possible.

1. Write and apply `supabase/migrations/003_org_stream.sql` (the DDL from §1.1)
2. Add `insertStream` + `getRecentStream` to [`lib/supabase.ts`](lib/supabase.ts:97)
3. Create `lib/stream.ts` with `captureChaTurn` + `captureFriction`
4. Hook into [`app/api/chat/route.ts`](app/api/chat/route.ts:625) — two fire-and-forget calls after `runAgentLoop` resolves
5. Run backfill SQL from §5.2 to populate from `hb_messages`

**Deliverable:** Every chat turn from this point creates a stream entry. Operator can `SELECT * FROM org_stream` and see the org's history.

### Phase 2 — Operator Dashboard (1 day)
**Goal:** Joseph can see what's happening across both orgs without logging into each.

6. Create `app/api/operator/stream/route.ts` (GET + POST from §4.1)
7. Create `app/api/operator/friction/route.ts` (§4.2)
8. Add minimal operator UI: a page at `/operator` (superadmin only) showing the unified feed with org/type/importance filters

**Deliverable:** Cross-tenant visibility. Joseph sees friction patterns within days of launch.

### Phase 3 — Knowledge Deepening (2 days)
**Goal:** `knowledge_files` updates automatically. The org's context gets richer without any manual work.

9. Verify `knowledge_files` table exists in Project A (check schema — may need a migration if it only exists as code reference)
10. Create `app/api/cron/knowledge-deepen/route.ts` (§3.2)
11. Add cron config to `vercel.json`
12. Add `CRON_SECRET` to Vercel environment variables

**Deliverable:** After 7 days, each org has an auto-updated knowledge file reflecting what they actually do. The system prompt enriches itself.

### Phase 4 — Cron Capture (0.5 days)
**Goal:** Every scheduled job's outcome is visible in the stream.

13. Add `withCronCapture` wrapper to `lib/stream.ts` (§2.7)
14. Wrap all existing cron routes with it

**Deliverable:** Cron health is observable. Failed jobs surface as high-importance stream entries.

### Phase 5 — Lifecycle Events (2-3 days)
**Goal:** Tasks, emails, orders, donations all captured.

15. Hook `captureTaskEvent` into dashboard card upserts in `app/api/dashboard/route.ts`
16. Add email capture to `executeTool` when send action exists
17. Build webhook handlers for Squarespace orders and donations (new routes)
18. Add compliance cron with deadline detection

**Deliverable:** The stream is a true activity log, not just chat notes.

### Phase 6 — Emergent Capability Discovery (1 day)
**Goal:** The system tells Joseph what each org needs next.

19. Add discovery queries (§6.2) to the knowledge deepening cron
20. Add `suggestDashboardCard` calls when patterns are detected
21. Operator UI: render `system_event` entries with `suggest_card` metadata as action buttons

**Deliverable:** HonorBase begins telling Joseph what to build next for each tenant, based on their own behavioral data.

---

## Appendix: File Inventory for This Feature

| File | Action | Notes |
|---|---|---|
| `supabase/migrations/003_org_stream.sql` | **Create** | Full DDL + view + RPC |
| `lib/supabase.ts` | **Edit** (add after line 96) | `insertStream`, `getRecentStream` |
| `lib/stream.ts` | **Create** | All capture functions + `withCronCapture` |
| `app/api/chat/route.ts` | **Edit** (add after line 624) | 2 fire-and-forget calls |
| `app/api/operator/stream/route.ts` | **Create** | Unified feed GET + operator inject POST |
| `app/api/operator/friction/route.ts` | **Create** | Aggregated friction by org |
| `app/api/cron/knowledge-deepen/route.ts` | **Create** | Daily synthesis + insight emission |
| `app/api/cron/squarespace-sync/route.ts` | **Create** (or edit) | Wrap with `withCronCapture` |
| `app/api/webhooks/squarespace/route.ts` | **Create** | Order fulfilled capture |
| `app/api/webhooks/donation/route.ts` | **Create** | Donation received capture |
| `app/page.tsx` | **Edit** | Add operator dashboard link for superadmin |
| `vercel.json` | **Create/Edit** | Add cron schedule for knowledge-deepen |
| `config/orgs/index.js` | **Edit** | Add `getAllOrgs()` export |

---

*This document is the design contract. Implementation starts at Phase 1. Do not build Phase 3 before Phase 1 is shipping.*

---

## 8. Intelligent Model Routing & Knowledge-as-Infrastructure

### 8.1 The Cost Curve Inversion

Every expensive (Opus) answer builds infrastructure that makes future answers cheap. The knowledge base isn't just memory — it's a cost-reduction engine. Over time, an org's cost-to-serve DECREASES while their value from the platform INCREASES. This is the core business moat.

Pattern:
- **First encounter** (novel question, no prior context) → Opus. Full research, reasoning, synthesis. Expensive. BUT: the output is tagged as reusable and stored as a knowledge artifact.
- **Second encounter** (similar question, org has context) → Sonnet. Adapt the existing artifact to current specifics. Half the cost.
- **Subsequent encounters** (routine, answer exists in KB) → Haiku. Database lookup + light formatting. Fractions of a penny.

### 8.2 Router Architecture

Every incoming message goes through a 3-step routing pipeline:

**Step 1 — Knowledge Base Check (before ANY model call)**
```javascript
// In app/api/chat/route.ts, before the main LLM call
const kbMatch = await checkKnowledgeBase(orgId, userMessage);
if (kbMatch.confidence > 0.85) {
  // Serve from Haiku with KB context — skip Sonnet/Opus entirely
  return streamHaikuWithContext(kbMatch.artifact, userMessage);
}
```
Query the org's `knowledge_files` + `org_stream` (filtered to `'insight'` and `'decision'` types) for semantic similarity to the incoming question. If high-confidence match exists, route to Haiku with the matched context as system prompt injection. No expensive model needed.

**Step 2 — Complexity Classification (Haiku, ~100ms, <$0.001)**
```javascript
const classification = await classifyComplexity(userMessage, orgContext);
// Returns: { level: 'lookup' | 'task' | 'project', confidence: number }
```
Haiku itself classifies the request:
- `lookup` → Haiku (data retrieval, simple Q&A, status checks)
- `task` → Sonnet (drafting, summarizing, planning, single-step work)
- `project` → Opus (multi-step, high-stakes, novel research, architectural decisions)

**Step 3 — Mid-Conversation Escalation**
If a conversation that started as a `lookup` evolves into a `project` (detected by turn count + complexity of follow-ups), seamlessly upgrade the model. The ED never sees a seam.

### 8.3 Knowledge Artifact Tagging

When Opus or Sonnet produces a substantive answer, tag it as a reusable artifact:

```sql
INSERT INTO org_knowledge_artifacts (
  org_id,
  query_pattern,     -- semantic embedding of the question that triggered this
  answer_summary,    -- one-line description
  answer_body,       -- full response (markdown)
  model_used,        -- 'opus' | 'sonnet'
  reuse_count,       -- starts at 0, increments on each KB hit
  domain_tags,       -- ['compliance', '990-ez', 'south-carolina']
  is_org_specific,   -- true if contains org-specific data
  is_generalizable,  -- true if useful across tenants (anonymized)
  created_at,
  last_reused_at
);
```

New table: `org_knowledge_artifacts` — the cache layer between expensive model calls and cheap lookups.

**Full DDL:**

```sql
-- Migration: 004_knowledge_artifacts.sql

CREATE TABLE IF NOT EXISTS public.org_knowledge_artifacts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT        NOT NULL,
  query_pattern     TEXT        NOT NULL,   -- original query text (embed offline)
  answer_summary    TEXT        NOT NULL,   -- one-line description
  answer_body       TEXT        NOT NULL,   -- full response, markdown
  model_used        TEXT        NOT NULL CHECK (model_used IN ('opus', 'sonnet')),
  reuse_count       INTEGER     NOT NULL DEFAULT 0,
  domain_tags       TEXT[]      NOT NULL DEFAULT '{}',
  is_org_specific   BOOLEAN     NOT NULL DEFAULT true,
  is_generalizable  BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reused_at    TIMESTAMPTZ
);

CREATE INDEX idx_knowledge_artifacts_org
  ON public.org_knowledge_artifacts (org_id, created_at DESC);

CREATE INDEX idx_knowledge_artifacts_tags
  ON public.org_knowledge_artifacts USING GIN (domain_tags);

CREATE INDEX idx_knowledge_artifacts_generalizable
  ON public.org_knowledge_artifacts (is_generalizable)
  WHERE is_generalizable = true;

ALTER TABLE public.org_knowledge_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_knowledge_artifacts"
  ON public.org_knowledge_artifacts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### 8.4 Cross-Tenant Learning

When `is_generalizable = true`, the artifact enters a shared knowledge pool (anonymized — no org-specific data):

**Full DDL:**

```sql
-- Migration: 004_knowledge_artifacts.sql (continued)

CREATE TABLE IF NOT EXISTS public.platform_knowledge_pool (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_artifact_id   UUID        REFERENCES public.org_knowledge_artifacts(id) ON DELETE SET NULL,
  domain_tags          TEXT[]      NOT NULL DEFAULT '{}',
  query_pattern        TEXT        NOT NULL,   -- generalized version of the original query
  answer_template      TEXT        NOT NULL,   -- anonymized answer template
  applicability_filter JSONB       NOT NULL DEFAULT '{}',
  -- e.g. {"state": "SC", "org_type": "501c3"}
  reuse_count          INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_pool_tags
  ON public.platform_knowledge_pool USING GIN (domain_tags);

CREATE INDEX idx_platform_pool_filter
  ON public.platform_knowledge_pool USING GIN (applicability_filter);

ALTER TABLE public.platform_knowledge_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_platform_pool"
  ON public.platform_knowledge_pool FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

Router Step 1 checks BOTH the org's knowledge base AND the platform pool. A new SC nonprofit asking about 990-EZ gets the answer template that was built for Steel Hearts — adapted to their specifics by Sonnet (not Opus), because the hard research was already done.

### 8.5 Cost Tracking Integration

Every model call logs its cost to the stream:

```javascript
// After every LLM response
await insertStreamEntry({
  org_id: orgId,
  stream_type: 'system_event',
  title: `Model call: ${model} (${inputTokens}+${outputTokens} tokens)`,
  metadata: {
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost: calculateCost(model, inputTokens, outputTokens),
    kb_hit: kbMatch?.confidence > 0.85,  // was this served from cache?
    classification: classification.level
  }
});
```

This gives Joseph real-time visibility into:
- Cost per org per day/week/month
- KB hit rate (what % of queries are served from cache vs. fresh model calls)
- Model distribution (what % Haiku vs Sonnet vs Opus)
- Cost curve over time (should trend DOWN for established orgs)

`calculateCost` reference rates (update as pricing changes):

```typescript
// lib/stream.ts
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    "claude-opus-4-6":           { input: 0.000015, output: 0.000075 },
    "claude-sonnet-4-6":         { input: 0.000003, output: 0.000015 },
    "claude-haiku-4-5-20251001": { input: 0.00000025, output: 0.00000125 },
  };
  const r = rates[model] || rates["claude-sonnet-4-6"];
  return inputTokens * r.input + outputTokens * r.output;
}
```

### 8.6 Subscription Tier Mapping

| Tier | Monthly | Haiku | Sonnet | Opus | Target Org |
|------|---------|-------|--------|------|------------|
| Starter | $29 | Unlimited | 100 calls | 5 calls | New org, exploring |
| Growth | $79 | Unlimited | 500 calls | 25 calls | Active org, building workflows |
| Scale | $199 | Unlimited | Unlimited | 100 calls | Full operating system |

As the knowledge base deepens, an org on the Growth tier naturally uses LESS Sonnet/Opus because more answers come from the KB via Haiku. Their effective capability increases while their model consumption decreases. The subscription price reflects the VALUE (access to the full platform + their growing KB), not the compute cost.

### 8.7 Build Priority

This integrates with Phase 1 of the main build order:

1. Add `model_used` and `estimated_cost` fields to `org_stream` metadata (trivial — it's already JSONB)
2. Add the KB check before the main LLM call in `route.ts` (Step 1)
3. Add the complexity classifier (Step 2) — can be a simple Haiku call or rule-based initially
4. Add `org_knowledge_artifacts` table (Phase 2 — migration `004_knowledge_artifacts.sql`)
5. Add `platform_knowledge_pool` table (Phase 3 — after multiple tenants exist)
6. Add cost dashboard to operator view (Phase 4)

Steps 1–3 are implementable in the same session as Phase 1 of the stream architecture. They share the same code paths in `app/api/chat/route.ts` and `lib/stream.ts`.
