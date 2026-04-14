import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side only — never import this in client components
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

type Message = { role: string; content: unknown };
type Card = { id: string; [key: string]: unknown };

// ── Conversation persistence ──────────────────────────────────────────────────

export async function loadMessages(orgId: string): Promise<Message[]> {
  try {
    const { data, error } = await supabase
      .from("hb_messages")
      .select("role, content")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });

    if (error) return []; // table may not exist yet — silent fallback
    return (data ?? []) as Message[];
  } catch {
    return [];
  }
}

export async function saveMessage(orgId: string, role: string, content: unknown) {
  try {
    await supabase.from("hb_messages").insert({ org_id: orgId, role, content });
  } catch {
    // silent — conversation still works, just not persisted
  }
}

// ── Dashboard card persistence ────────────────────────────────────────────────

export async function loadCards(orgId: string): Promise<Card[]> {
  try {
    const { data, error } = await supabase
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
    await supabase.from("hb_dashboard_cards").upsert({
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
    await supabase
      .from("hb_dashboard_cards")
      .delete()
      .eq("org_id", orgId)
      .eq("card_id", cardId);
  } catch {
    // silent
  }
}
