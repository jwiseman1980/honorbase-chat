import { NextRequest } from "next/server";
import {
  loadBuildQueue,
  saveBuildQueueItem,
  updateBuildQueueItem,
  deleteBuildQueueItem,
  getOrgStats,
} from "@/lib/supabase";

export async function GET() {
  const [buildQueue, orgStats] = await Promise.all([
    loadBuildQueue(),
    getOrgStats(["drmf", "steel-hearts"]),
  ]);

  const env = process.env;

  const systemHealth: Record<string, { status: "ok" | "warning" | "error"; message: string }> = {
    Supabase: {
      status: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? "ok" : "error",
      message: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? "Connected"
        : "Missing SUPABASE_URL or SERVICE_ROLE_KEY",
    },
    "Anthropic API": {
      status: env.ANTHROPIC_API_KEY ? "ok" : "error",
      message: env.ANTHROPIC_API_KEY ? "Configured" : "Missing ANTHROPIC_API_KEY",
    },
    "Google OAuth": {
      status: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? "ok" : "error",
      message:
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? "Configured"
          : "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET",
    },
    "Google Service Account": {
      status: env.GOOGLE_SERVICE_ACCOUNT_KEY ? "ok" : "warning",
      message: env.GOOGLE_SERVICE_ACCOUNT_KEY
        ? "Configured (Gmail + Calendar)"
        : "Not set — Gmail and Calendar unavailable",
    },
    Slack: {
      status: env.SLACK_BOT_TOKEN ? "ok" : "warning",
      message: env.SLACK_BOT_TOKEN
        ? "Configured"
        : "Not set — Slack tool unavailable",
    },
    "NextAuth Secret": {
      status: env.NEXTAUTH_SECRET || env.AUTH_SECRET ? "ok" : "error",
      message:
        env.NEXTAUTH_SECRET || env.AUTH_SECRET ? "Configured" : "Missing secret",
    },
  };

  return Response.json({ buildQueue, orgStats, systemHealth });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, id, item, fields } = body as {
    action: string;
    id?: string;
    item?: Record<string, unknown>;
    fields?: Record<string, unknown>;
  };

  if (action === "add" && item) {
    const result = await saveBuildQueueItem(item as Parameters<typeof saveBuildQueueItem>[0]);
    return Response.json({ ok: true, item: result });
  }

  if (action === "update" && id && fields) {
    await updateBuildQueueItem(id, fields as Parameters<typeof updateBuildQueueItem>[1]);
    return Response.json({ ok: true });
  }

  if (action === "delete" && id) {
    await deleteBuildQueueItem(id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action or missing fields" }, { status: 400 });
}
