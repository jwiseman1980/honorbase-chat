import { createClient } from "@supabase/supabase-js";

// Server-side only — never import this in client components.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: ReturnType<typeof createClient<any>> | null = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client = createClient<any>(url, key, { auth: { persistSession: false } });
  return _client;
}

export interface DashboardCard {
  title: string;
  body: string;
  cardType: "action" | "insight" | "alert" | "draft" | "metric";
  priority: number;
  actionType: string;
  actionTarget: string;
  metadata?: Record<string, unknown>;
}

/** Derive a stable card_id from the title so same-titled cards upsert. */
function titleToCardId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/**
 * Inject (upsert) a dashboard card for an org.
 *
 * Called mid-conversation when the chat agent generates a contextual card —
 * e.g. "show me my financials" produces a financial summary card that appears
 * in the dashboard immediately without a page refresh.
 *
 * Cards with the same title are updated in place; new titles produce new cards.
 */
export async function injectDashboardCard(
  orgId: string,
  card: DashboardCard
): Promise<void> {
  try {
    const sb = getClient();
    if (!sb) return;

    const cardId = titleToCardId(card.title);
    const now = new Date().toISOString();

    await sb.from("hb_dashboard_cards").upsert({
      org_id: orgId,
      card_id: cardId,
      // Keep data JSONB in sync so legacy readers still work
      data: {
        id: cardId,
        title: card.title,
        body: card.body,
        card_type: card.cardType,
        priority: card.priority,
        action_type: card.actionType,
        action_target: card.actionTarget,
        metadata: card.metadata ?? {},
        updated_at: now,
      },
      card_type: card.cardType,
      priority: card.priority,
      action_type: card.actionType,
      action_target: card.actionTarget,
      generated_at: now,
      generated_by: "chat",
    });
  } catch {
    // Card injection is best-effort — never crash the chat response.
  }
}
