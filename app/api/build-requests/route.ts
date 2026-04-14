import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export interface BuildRequest {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  requested_at: string;
  status: "pending" | "in_progress" | "completed";
  completed_at?: string;
  url?: string;
}

function getPath(orgId: string) {
  return path.join(process.cwd(), "data", "build_requests", `${orgId}.json`);
}

function load(orgId: string): BuildRequest[] {
  try {
    return JSON.parse(fs.readFileSync(getPath(orgId), "utf-8"));
  } catch {
    return [];
  }
}

function save(orgId: string, items: BuildRequest[]) {
  const p = getPath(orgId);
  if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(items, null, 2));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId") ?? "";
  return new Response(JSON.stringify(load(orgId)), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orgId, request } = body;
  if (!orgId || !request) {
    return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
  }

  const items = load(orgId);

  if (request.action === "complete" && request.id) {
    const idx = items.findIndex((i) => i.id === request.id);
    if (idx >= 0) {
      items[idx].status = "completed";
      items[idx].completed_at = new Date().toISOString();
      if (request.url) items[idx].url = request.url;
    }
  } else {
    // New request
    const newItem: BuildRequest = {
      id: `br-${Date.now()}`,
      title: request.title,
      description: request.description,
      priority: request.priority ?? "medium",
      requested_at: request.requested_at ?? new Date().toISOString(),
      status: "pending",
    };
    items.unshift(newItem);
  }

  save(orgId, items);
  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
}
