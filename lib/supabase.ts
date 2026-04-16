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

// ── Build queue ───────────────────────────────────────────────────────────────

export type BuildQueueItem = {
  id: string;
  description: string;
  requested_by_org: string | null;
  priority: "high" | "medium" | "low";
  status: "backlog" | "in-progress" | "done";
  source: "chat" | "manual";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function loadBuildQueue(): Promise<BuildQueueItem[]> {
  try {
    const sb = getClient();
    if (!sb) return [];
    const { data } = await sb
      .from("build_queue")
      .select("*")
      .order("created_at", { ascending: false });
    return (data ?? []) as BuildQueueItem[];
  } catch {
    return [];
  }
}

export async function saveBuildQueueItem(item: {
  description: string;
  requested_by_org?: string | null;
  priority?: string;
  status?: string;
  source?: string;
  notes?: string | null;
}): Promise<BuildQueueItem | null> {
  try {
    const sb = getClient();
    if (!sb) return null;
    const { data } = await sb
      .from("build_queue")
      .insert({
        description: item.description,
        requested_by_org: item.requested_by_org ?? null,
        priority: item.priority ?? "medium",
        status: item.status ?? "backlog",
        source: item.source ?? "manual",
        notes: item.notes ?? null,
      })
      .select()
      .single();
    return data as BuildQueueItem | null;
  } catch {
    return null;
  }
}

export async function updateBuildQueueItem(
  id: string,
  fields: Partial<BuildQueueItem>
): Promise<void> {
  try {
    const sb = getClient();
    if (!sb) return;
    await sb
      .from("build_queue")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    // silent
  }
}

export async function deleteBuildQueueItem(id: string): Promise<void> {
  try {
    const sb = getClient();
    if (!sb) return;
    await sb.from("build_queue").delete().eq("id", id);
  } catch {
    // silent
  }
}

// ── Org membership ────────────────────────────────────────────────────────────

/** Returns true if the given email is in org_members for the given org. */
export async function checkOrgMember(orgId: string, email: string): Promise<boolean> {
  try {
    const sb = getClient();
    if (!sb) return false;
    const { data, error } = await sb
      .from("org_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("email", email)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

// ── Org stats ─────────────────────────────────────────────────────────────────

export type OrgStat = {
  totalMessages: number;
  messagesThisWeek: number;
  lastActive: string | null;
};

export async function getOrgStats(
  orgIds: string[]
): Promise<Record<string, OrgStat>> {
  try {
    const sb = getClient();
    if (!sb) return {};
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results = await Promise.all(
      orgIds.map(async (orgId) => {
        const [total, thisWeek, lastMsg] = await Promise.all([
          sb
            .from("hb_messages")
            .select("*", { count: "exact", head: true })
            .eq("org_id", orgId),
          sb
            .from("hb_messages")
            .select("*", { count: "exact", head: true })
            .eq("org_id", orgId)
            .gte("created_at", weekAgo),
          sb
            .from("hb_messages")
            .select("created_at")
            .eq("org_id", orgId)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        return {
          orgId,
          totalMessages: total.count ?? 0,
          messagesThisWeek: thisWeek.count ?? 0,
          lastActive:
            (lastMsg.data?.[0] as { created_at?: string } | undefined)
              ?.created_at ?? null,
        };
      })
    );

    return Object.fromEntries(
      results.map((r) => [
        r.orgId,
        {
          totalMessages: r.totalMessages,
          messagesThisWeek: r.messagesThisWeek,
          lastActive: r.lastActive,
        },
      ])
    );
  } catch {
    return {};
  }
}
