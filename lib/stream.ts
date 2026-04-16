// lib/stream.ts — fire-and-forget activity log for org_stream table.
// Server-side only. Uses the same lazy-singleton Supabase client as lib/supabase.ts.

import { createClient } from "@supabase/supabase-js";

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

export type StreamType =
  | "chat_turn"
  | "friction"
  | "task_completed"
  | "milestone"
  | "alert"
  | "note";

export type Importance = "low" | "medium" | "high" | "critical";

interface LogToStreamParams {
  orgId: string;
  streamType: StreamType;
  actor?: string;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown>;
  relatedTable?: string | null;
  relatedId?: string | null;
  tags?: string[];
  importance?: Importance;
}

/**
 * Insert one entry into org_stream. Always fire-and-forget — call without await
 * so the chat response is never delayed. Errors are logged to console only.
 */
export async function logToStream({
  orgId,
  streamType,
  actor = "system",
  title,
  body = null,
  metadata = {},
  relatedTable = null,
  relatedId = null,
  tags = [],
  importance = "medium",
}: LogToStreamParams): Promise<void> {
  const sb = getClient();
  if (!sb) return;

  const { error } = await sb.from("org_stream").insert({
    org_id: orgId,
    stream_type: streamType,
    actor,
    title,
    body,
    metadata,
    related_table: relatedTable,
    related_id: relatedId,
    tags,
    importance,
  });

  if (error) console.error("[stream] insert failed:", error.message);
}
