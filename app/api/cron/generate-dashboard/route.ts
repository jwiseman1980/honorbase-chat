import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { orgs } from "@/config/orgs/index.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgConfig {
  orgId: string;
  orgName: string;
}

interface GeneratedCard {
  title: string;
  body: string;
  card_type: "action" | "insight" | "alert" | "draft" | "metric";
  priority: number;
  action_type: string;
  action_target: string;
  metadata?: Record<string, unknown>;
}

interface OrgContext {
  stream: unknown[];
  friction: unknown[];
  compliance: unknown[];
  orders: unknown[];
  tasks: unknown[];
}

// ── Supabase client (module-level singleton) ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: SupabaseClient<any> | null = null;

function getSupabase() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _sb = createClient<any>(url, key, { auth: { persistSession: false } });
  return _sb;
}

// ── Context fetching (graceful degradation on missing tables) ─────────────────

async function fetchOrgContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any>,
  orgId: string
): Promise<OrgContext> {
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const in30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const [streamRes, frictionRes, complianceRes, ordersRes, tasksRes] =
    await Promise.allSettled([
      // (a) Recent activity stream
      sb
        .from("org_stream")
        .select("stream_type, actor, title, body, metadata, importance, created_at")
        .eq("org_id", orgId)
        .gt("created_at", since48h)
        .order("created_at", { ascending: false })
        .limit(200),

      // (e) Friction events in last 7 days
      sb
        .from("org_stream")
        .select("title, body, metadata, created_at")
        .eq("org_id", orgId)
        .eq("stream_type", "friction")
        .gt("created_at", since7d),

      // (b) Upcoming compliance deadlines (next 30 days)
      sb
        .from("compliance_items")
        .select("title, due_date, status, notes")
        .eq("org_id", orgId)
        .lte("due_date", in30d)
        .gt("due_date", now),

      // (c) Unfulfilled orders
      sb
        .from("order_items")
        .select("title, quantity, production_status, created_at")
        .eq("org_id", orgId)
        .not("production_status", "in", '("shipped","ready_to_ship")'),

      // (d) Unresolved tasks
      sb
        .from("tasks")
        .select("title, description, due_date, priority, created_at")
        .eq("org_id", orgId)
        .eq("completed", false)
        .limit(50),
    ]);

  return {
    stream:
      streamRes.status === "fulfilled" ? (streamRes.value.data ?? []) : [],
    friction:
      frictionRes.status === "fulfilled" ? (frictionRes.value.data ?? []) : [],
    compliance:
      complianceRes.status === "fulfilled"
        ? (complianceRes.value.data ?? [])
        : [],
    orders:
      ordersRes.status === "fulfilled" ? (ordersRes.value.data ?? []) : [],
    tasks: tasksRes.status === "fulfilled" ? (tasksRes.value.data ?? []) : [],
  };
}

// ── Card generation via Claude Haiku ─────────────────────────────────────────

async function generateCards(
  orgName: string,
  context: OrgContext
): Promise<GeneratedCard[]> {
  const contextBlock = [
    `Activity stream — last 48h (${context.stream.length} entries):`,
    JSON.stringify(context.stream),
    ``,
    `Friction events — last 7d (${context.friction.length} entries):`,
    JSON.stringify(context.friction),
    ``,
    `Upcoming compliance deadlines — next 30d:`,
    JSON.stringify(context.compliance),
    ``,
    `Unfulfilled orders:`,
    JSON.stringify(context.orders),
    ``,
    `Unresolved tasks:`,
    JSON.stringify(context.tasks),
  ].join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: `You are the HonorBase dashboard generator for the org "${orgName}".
Based on the activity stream, pending items, and upcoming deadlines provided, generate 4-8 dashboard cards prioritized by urgency and importance.

Each card must be a JSON object with these fields:
- title: string — one line, action-oriented (e.g. "File your 990-EZ — due in 14 days")
- body: string — 2-3 sentences of context
- card_type: "action" | "insight" | "alert" | "draft" | "metric"
- priority: number 1-10 (10 = most urgent)
- action_type: "navigate" | "draft" | "chat" | "external_link"
- action_target: string — URL, draft ID, or chat prompt to execute
- metadata: object — optional structured data for rendering (counts, amounts, dates)

Rules:
- Only generate cards for categories that have actual data. Do not invent items.
- If a section is empty, skip it rather than fabricating cards.
- Return ONLY a valid JSON array. No prose, no markdown fences, no explanation.`,
    messages: [{ role: "user", content: contextBlock }],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  // Extract JSON array even if Haiku wraps it in markdown fences
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? (parsed as GeneratedCard[]) : [];
  } catch {
    return [];
  }
}

// ── Per-org pipeline ──────────────────────────────────────────────────────────

async function processOrg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any>,
  orgId: string,
  orgName: string
): Promise<{ orgId: string; cardCount: number; error?: string }> {
  try {
    const context = await fetchOrgContext(sb, orgId);

    const totalItems =
      context.stream.length +
      context.compliance.length +
      context.orders.length +
      context.tasks.length;

    if (totalItems === 0) {
      return { orgId, cardCount: 0 };
    }

    const cards = await generateCards(orgName, context);
    if (cards.length === 0) return { orgId, cardCount: 0 };

    // Replace all cron-generated cards for this org atomically
    await sb
      .from("hb_dashboard_cards")
      .delete()
      .eq("org_id", orgId)
      .eq("generated_by", "cron");

    const ts = Date.now();
    const now = new Date(ts).toISOString();

    const rows = cards.map((card, i) => {
      const cardId = `cron-${ts}-${i}`;
      return {
        org_id: orgId,
        card_id: cardId,
        data: {
          id: cardId,
          title: card.title,
          body: card.body,
          card_type: card.card_type,
          priority: card.priority,
          action_type: card.action_type,
          action_target: card.action_target,
          metadata: card.metadata ?? {},
          updated_at: now,
        },
        card_type: card.card_type,
        priority: card.priority ?? 5,
        action_type: card.action_type,
        action_target: card.action_target,
        generated_at: now,
        generated_by: "cron",
      };
    });

    await sb.from("hb_dashboard_cards").insert(rows);

    return { orgId, cardCount: cards.length };
  } catch (err) {
    return { orgId, cardCount: 0, error: String(err) };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Vercel injects CRON_SECRET and sends it as a Bearer token on each cron hit.
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabase();
  if (!sb) {
    return Response.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  const allOrgs = Object.values(orgs) as OrgConfig[];

  const results = await Promise.allSettled(
    allOrgs.map((org) => processOrg(sb, org.orgId, org.orgName))
  );

  const summary = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { error: String(r.reason), cardCount: 0 }
  );

  return Response.json({
    generated: summary,
    timestamp: new Date().toISOString(),
  });
}
