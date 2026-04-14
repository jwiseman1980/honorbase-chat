import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getOrgById } from "@/config/orgs/index.js";
import { loadMessages, saveMessage } from "@/lib/supabase";
import fs from "fs";
import path from "path";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "web_fetch",
    description:
      "Fetch the text content of a web page. Use this when asked to look up a specific URL, read a page, or check a website.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The full URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for current information. Use this when asked to research a topic, find organizations, look up deadlines, or get information you don't already have.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, string>
): Promise<string> {
  if (name === "web_fetch") {
    const { url } = input;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; HonorBase/1.0; +https://honorbase-chat.vercel.app)",
        },
        signal: AbortSignal.timeout(12000),
      });
      const html = await res.text();
      const text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 25000);
      return text || "Could not extract readable content from this URL.";
    } catch (err) {
      return `Failed to fetch ${url}: ${err instanceof Error ? err.message : "network error"}`;
    }
  }

  if (name === "web_search") {
    const { query } = input;
    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(
        `https://html.duckduckgo.com/html/?q=${encoded}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; HonorBase/1.0; +https://honorbase-chat.vercel.app)",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(12000),
        }
      );
      const html = await res.text();

      // Extract result snippets from DuckDuckGo Lite HTML
      const results: string[] = [];
      const titleRe = /class="result__title"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const titles: Array<{ url: string; title: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = titleRe.exec(html)) !== null && titles.length < 6) {
        titles.push({
          url: m[1].replace(/\*\*.*$/, ""),
          title: m[2].replace(/<[^>]+>/g, "").trim(),
        });
      }

      const snippets: string[] = [];
      while ((m = snippetRe.exec(html)) !== null && snippets.length < 6) {
        snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
      }

      for (let i = 0; i < Math.max(titles.length, snippets.length); i++) {
        const t = titles[i];
        const s = snippets[i] || "";
        if (t) results.push(`**${t.title}**\n${t.url}\n${s}`);
        else if (s) results.push(s);
      }

      if (results.length === 0) {
        // Fallback: return plain text from the page
        const plain = html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 4000);
        return `Search results for "${query}":\n${plain}`;
      }
      return `Search results for "${query}":\n\n${results.join("\n\n")}`;
    } catch (err) {
      return `Search failed: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }

  return "Unknown tool";
}

// ── Message type helpers ──────────────────────────────────────────────────────

type IncomingMessage = {
  role: string;
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        data?: string;
        mediaType?: string;
        filename?: string;
      }>;
};

function toAnthropicMessages(
  messages: IncomingMessage[]
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role as "user" | "assistant", content: msg.content };
    }
    const parts = msg.content.map((part) => {
      if (part.type === "text") return { type: "text" as const, text: part.text! };
      if (part.type === "image") {
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: part.mediaType as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
            data: part.data!,
          },
        };
      }
      return { type: "text" as const, text: `[Attached file: ${part.filename}]` };
    });
    return { role: msg.role as "user" | "assistant", content: parts };
  });
}

// ── Agentic tool loop ─────────────────────────────────────────────────────────

async function runAgentLoop(
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  onTool: (name: string) => void
): Promise<string> {
  let current = [...messages];

  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: current,
      tools: TOOLS,
    });

    if (response.stop_reason === "end_turn") {
      return response.content
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("");
    }

    if (response.stop_reason === "tool_use") {
      const toolBlocks = response.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolBlocks.map(async (tool) => {
          onTool(tool.name);
          const result = await executeTool(
            tool.name,
            tool.input as Record<string, string>
          );
          return {
            type: "tool_result" as const,
            tool_use_id: tool.id,
            content: result,
          };
        })
      );

      current.push({ role: "assistant", content: response.content });
      current.push({ role: "user", content: toolResults });
      continue;
    }

    // Unexpected stop reason — extract any text
    return response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");
  }

  return "I hit a tool-use limit. Please try rephrasing your question.";
}

// ── File-based fallback (local dev only) ─────────────────────────────────────

function loadLocalConversation(orgId: string): IncomingMessage[] {
  try {
    const p = path.join(process.cwd(), "data", "conversations", `${orgId}.json`);
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function saveLocalConversation(orgId: string, messages: IncomingMessage[]) {
  try {
    const p = path.join(process.cwd(), "data", "conversations", `${orgId}.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(messages, null, 2));
  } catch {
    // ignore
  }
}

function saveBuildRequest(orgId: string, req: Record<string, unknown>) {
  try {
    const p = path.join(process.cwd(), "data", "build_requests", `${orgId}.json`);
    let brs: unknown[] = [];
    try {
      brs = JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      /* empty */
    }
    brs.unshift({ id: `br-${Date.now()}`, ...req, status: "pending" });
    fs.writeFileSync(p, JSON.stringify(brs, null, 2));
  } catch {
    // ignore on Vercel
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, orgId } = body as {
    messages: IncomingMessage[];
    orgId: string;
  };

  const org = getOrgById(orgId);
  if (!org) {
    return new Response(JSON.stringify({ error: "Unknown org" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const anthropicMessages = toAnthropicMessages(messages);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const toolsUsed: string[] = [];

      try {
        // Emit pending indicator immediately so UI shows activity
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ pending: true })}\n\n`)
        );

        const fullText = await runAgentLoop(
          anthropicMessages,
          org.systemPrompt,
          (toolName) => {
            toolsUsed.push(toolName);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ tool: toolName })}\n\n`
              )
            );
          }
        );

        // Parse and persist build_requests (best-effort, no Vercel filesystem)
        const buildMatches = fullText.matchAll(/```build_request\n([\s\S]*?)```/g);
        for (const match of buildMatches) {
          try {
            const br = JSON.parse(match[1].trim());
            saveBuildRequest(orgId, br);
          } catch {
            /* skip malformed */
          }
        }

        // Persist to Supabase (fire-and-forget)
        const lastUserMsg = messages[messages.length - 1];
        if (lastUserMsg) {
          saveMessage(orgId, "user", lastUserMsg.content);
        }
        saveMessage(orgId, "assistant", fullText);

        // Also persist locally for dev
        const updatedMessages = [
          ...messages,
          { role: "assistant", content: fullText },
        ];
        saveLocalConversation(orgId, updatedMessages);

        // Emit text as a single chunk (agentic responses don't stream char-by-char)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: fullText })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
      } catch (err) {
        console.error("Agent loop error:", err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Response failed — please try again." })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId");
  if (!orgId) return new Response("[]");

  // Try Supabase first; fall back to local file
  const msgs = await loadMessages(orgId);
  if (msgs.length > 0) {
    return new Response(JSON.stringify(msgs), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const local = loadLocalConversation(orgId);
  return new Response(JSON.stringify(local), {
    headers: { "Content-Type": "application/json" },
  });
}
