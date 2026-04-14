import { createClient } from "@supabase/supabase-js";

// Server-side only — never import this in client components.
// Client is lazily initialized so the module can be imported at build time
// without env vars (API routes are never statically executed by Next.js).
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

type Message = { role: string; content: unknown };
type Card = { id: string; [key: string]: unknown };

// ── Conversation persistence ──────────────────────────────────────────────────

export async function loadMessages(orgId: string): Promise<Message[]> {
  try {
    const sb = getClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from("hb_messages")
      .select("role, content")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });

    if (error) return [];
    return (data ?? []) as Message[];
  } catch {
    return [];
  }
}

export async function saveMessage(orgId: string, role: string, content: unknown) {
  try {
    const sb = getClient();
    if (!sb) return;
    await sb.from("hb_messages").insert({ org_id: orgId, role, content });
  } catch {
    // silent
  }
}

// ── Dashboard card persistence ────────────────────────────────────────────────

export async function loadCards(orgId: string): Promise<Card[]> {
  try {
    const sb = getClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from("hb_dashboard_cards")
      .select("card_id, data")
      .eq("org_id", orgId)
      .order("data->>created_at", { ascending: true });

    if (error) return [];
    return (data ?? []).map((row) => ({ ...(row.data as object), id: row.card_id }));
  } catch {
    return [];
  }
}

export async function upsertCard(orgId: string, card: Card) {
  try {
    const sb = getClient();
    if (!sb) return;
    await sb.from("hb_dashboard_cards").upsert({
      org_id: orgId,
      card_id: card.id,
      data: { ...card, updated_at: new Date().toISOString() },
    });
  } catch {
    // silent
  }
}

export async function deleteCard(orgId: string, cardId: string) {
  try {
    const sb = getClient();
    if (!sb) return;
    await sb
      .from("hb_dashboard_cards")
      .delete()
      .eq("org_id", orgId)
      .eq("card_id", cardId);
  } catch {
    // silent
  }
}
