import { NextRequest } from "next/server";
import { loadCards, upsertCard, deleteCard } from "@/lib/supabase";
import fs from "fs";
import path from "path";

type Card = { id: string; [key: string]: unknown };

// ── Local file fallback (dev only) ───────────────────────────────────────────

function getDashboardPath(orgId: string) {
  return path.join(process.cwd(), "data", "dashboard", `${orgId}.json`);
}

function loadLocalDashboard(orgId: string): Card[] {
  try {
    return JSON.parse(fs.readFileSync(getDashboardPath(orgId), "utf-8"));
  } catch {
    return [];
  }
}

function saveLocalDashboard(orgId: string, cards: Card[]) {
  try {
    const p = getDashboardPath(orgId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cards, null, 2));
  } catch {
    // ignore on Vercel
  }
}

// ── GET /api/dashboard?orgId=xxx ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId");
  if (!orgId)
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });

  // Try Supabase first; fall back to local file
  const cards = await loadCards(orgId);
  if (cards.length > 0) {
    return new Response(JSON.stringify(cards), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const local = loadLocalDashboard(orgId);
  return new Response(JSON.stringify(local), {
    headers: { "Content-Type": "application/json" },
  });
}

// ── POST /api/dashboard ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orgId, action, card } = body as {
    orgId: string;
    action: string;
    card: Card;
  };

  if (!orgId || !action || !card) {
    return new Response(JSON.stringify({ error: "Missing fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Supabase (best-effort)
  if (action === "add" || action === "update") {
    await upsertCard(orgId, card);
  } else if (action === "remove") {
    await deleteCard(orgId, card.id);
  }

  // Also maintain local file for dev
  let cards = loadLocalDashboard(orgId);
  if (action === "add") {
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) cards[idx] = { ...cards[idx], ...card };
    else cards.push(card);
  } else if (action === "update") {
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) cards[idx] = { ...cards[idx], ...card };
  } else if (action === "remove") {
    cards = cards.filter((c) => c.id !== card.id);
  }
  saveLocalDashboard(orgId, cards);

  // Return from Supabase if available, otherwise local
  const fresh = await loadCards(orgId);
  const result = fresh.length > 0 ? fresh : cards;

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
