import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

function getDashboardPath(orgId: string) {
  return path.join(process.cwd(), "data", "dashboard", `${orgId}.json`);
}

function loadDashboard(orgId: string) {
  const filePath = getDashboardPath(orgId);
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveDashboard(orgId: string, cards: unknown[]) {
  const filePath = getDashboardPath(orgId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cards, null, 2));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId");
  if (!orgId)
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  const cards = loadDashboard(orgId);
  return new Response(JSON.stringify(cards), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const { orgId, action, card } = await req.json();
  if (!orgId || !action || !card) {
    return new Response(JSON.stringify({ error: "Missing fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let cards = loadDashboard(orgId);

  if (action === "add") {
    const existing = cards.findIndex((c: { id: string }) => c.id === card.id);
    if (existing >= 0) {
      cards[existing] = { ...cards[existing], ...card };
    } else {
      cards.push(card);
    }
  } else if (action === "update") {
    const existing = cards.findIndex((c: { id: string }) => c.id === card.id);
    if (existing >= 0) {
      cards[existing] = { ...cards[existing], ...card };
    }
  } else if (action === "remove") {
    cards = cards.filter((c: { id: string }) => c.id !== card.id);
  }

  saveDashboard(orgId, cards);
  return new Response(JSON.stringify(cards), {
    headers: { "Content-Type": "application/json" },
  });
}
