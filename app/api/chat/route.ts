import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getOrgById } from "@/config/orgs/index.js";
import { loadMessages, saveMessage, saveBuildQueueItem } from "@/lib/supabase";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool definitions ──────────────────────────────────────────────────────────

const ALL_TOOLS: Anthropic.Tool[] = [
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
  {
    name: "gmail",
    description:
      "Read emails from the connected Gmail account. Use to list recent emails (with optional search query) or read a specific email by ID. Use proactively when the user asks about email, messages, or anything that might be in their inbox.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list_recent", "read"],
          description: "list_recent: list emails matching a query. read: read a specific email by message_id.",
        },
        query: {
          type: "string",
          description: "Gmail search query (e.g. 'is:unread', 'from:someone@example.com', 'subject:meeting'). Used for list_recent.",
        },
        message_id: {
          type: "string",
          description: "The Gmail message ID to read in full. Used for read action.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "google_calendar",
    description:
      "View upcoming events from the connected Google Calendar. Returns events for the next N days.",
    input_schema: {
      type: "object" as const,
      properties: {
        days_ahead: {
          type: "number",
          description: "How many days ahead to look for events (default: 7, max: 30).",
        },
      },
      required: [],
    },
  },
  {
    name: "slack",
    description:
      "Read messages from the connected Slack workspace. List channels or read recent messages from a specific channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list_channels", "read_channel"],
          description: "list_channels: list all channels. read_channel: read recent messages from a channel.",
        },
        channel: {
          type: "string",
          description: "Channel name (e.g. 'general') or Slack channel ID. Required for read_channel.",
        },
      },
      required: ["action"],
    },
  },
];

// ── Google service account auth ───────────────────────────────────────────────

async function getGoogleAccessToken(impersonateEmail: string, scope: string): Promise<string | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) return null;
  try {
    const { createSign } = await import("crypto");
    const key = JSON.parse(keyJson);
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: key.client_email,
        sub: impersonateEmail,
        scope,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    ).toString("base64url");
    const sign = createSign("RSA-SHA256");
    sign.update(`${header}.${payload}`);
    const sig = sign.sign(key.private_key, "base64url");
    const jwt = `${header}.${payload}.${sig}`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  orgEmail?: string
): Promise<string> {
  if (name === "web_fetch") {
    const url = input.url as string;
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
    const query = input.query as string;
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

  if (name === "gmail") {
    if (!orgEmail) return "Gmail is not configured for this organization.";
    const token = await getGoogleAccessToken(
      orgEmail,
      "https://www.googleapis.com/auth/gmail.readonly"
    );
    if (!token) return "Gmail not available — GOOGLE_SERVICE_ACCOUNT_KEY is not configured.";

    const action = input.action as string;

    if (action === "read") {
      const messageId = input.message_id as string;
      if (!messageId) return "message_id is required for read action.";
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) }
        );
        const msg = await res.json();
        const headers: Array<{ name: string; value: string }> = msg.payload?.headers || [];
        const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
        const from = headers.find((h) => h.name === "From")?.value || "";
        const date = headers.find((h) => h.name === "Date")?.value || "";

        function extractBody(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): string {
          if (part.mimeType === "text/plain" && part.body?.data) {
            return Buffer.from(part.body.data, "base64").toString("utf-8");
          }
          if (part.parts) {
            for (const p of part.parts as typeof part[]) {
              const b = extractBody(p);
              if (b) return b;
            }
          }
          return "";
        }
        const body = extractBody(msg.payload || {}).slice(0, 4000);
        return `From: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
      } catch (err) {
        return `Failed to read email: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    // Default: list_recent
    const query = (input.query as string) || "in:inbox";
    try {
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) }
      );
      const listData = await listRes.json();
      const messageIds: Array<{ id: string }> = (listData.messages || []).slice(0, 10);
      if (messageIds.length === 0) return `No emails found for query: ${query}`;

      const details = await Promise.all(
        messageIds.map(async ({ id }) => {
          const r = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
          );
          const m = await r.json();
          const hdrs: Array<{ name: string; value: string }> = m.payload?.headers || [];
          return {
            id,
            subject: hdrs.find((h) => h.name === "Subject")?.value || "(no subject)",
            from: hdrs.find((h) => h.name === "From")?.value || "",
            date: hdrs.find((h) => h.name === "Date")?.value || "",
            snippet: (m.snippet || "") as string,
          };
        })
      );

      return details
        .map(
          (m, i) =>
            `${i + 1}. **${m.subject}**\n   From: ${m.from}\n   Date: ${m.date}\n   ID: ${m.id}\n   ${m.snippet}`
        )
        .join("\n\n");
    } catch (err) {
      return `Failed to list emails: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }

  if (name === "google_calendar") {
    if (!orgEmail) return "Google Calendar is not configured for this organization.";
    const token = await getGoogleAccessToken(
      orgEmail,
      "https://www.googleapis.com/auth/calendar.readonly"
    );
    if (!token) return "Google Calendar not available — GOOGLE_SERVICE_ACCOUNT_KEY is not configured.";

    const daysAhead = Math.min(Number(input.days_ahead) || 7, 30);
    const now = new Date();
    const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
          `timeMin=${encodeURIComponent(now.toISOString())}&` +
          `timeMax=${encodeURIComponent(end.toISOString())}&` +
          `singleEvents=true&orderBy=startTime&maxResults=20`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) }
      );
      const data = await res.json();
      const events: Array<{
        summary?: string;
        start?: { dateTime?: string; date?: string };
        location?: string;
        description?: string;
      }> = data.items || [];

      if (events.length === 0) return `No events in the next ${daysAhead} days.`;

      return events
        .map((e) => {
          const start = e.start?.dateTime || e.start?.date || "Unknown";
          const startFormatted = new Date(start).toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          const lines = [`• **${e.summary || "(untitled)"}** — ${startFormatted}`];
          if (e.location) lines.push(`  Location: ${e.location}`);
          if (e.description) lines.push(`  ${e.description.slice(0, 120)}`);
          return lines.join("\n");
        })
        .join("\n\n");
    } catch (err) {
      return `Failed to fetch calendar: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }

  if (name === "slack") {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return "Slack not available — SLACK_BOT_TOKEN is not configured.";

    const action = input.action as string;

    if (action === "list_channels") {
      try {
        const res = await fetch(
          "https://slack.com/api/conversations.list?limit=100&types=public_channel,private_channel",
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
        );
        const data = await res.json();
        if (!data.ok) return `Slack error: ${data.error}`;
        const channels: Array<{ name: string; is_private: boolean; num_members: number; is_archived: boolean }> =
          (data.channels || []).filter((c: { is_archived: boolean }) => !c.is_archived);
        return channels
          .map((c) => `• #${c.name}${c.is_private ? " 🔒" : ""} — ${c.num_members || 0} members`)
          .join("\n");
      } catch (err) {
        return `Failed to list Slack channels: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    if (action === "read_channel") {
      const channelInput = (input.channel as string) || "";
      if (!channelInput) return "channel is required for read_channel action.";
      try {
        let channelId = channelInput.startsWith("C") ? channelInput : "";
        if (!channelId) {
          const listRes = await fetch(
            "https://slack.com/api/conversations.list?limit=200",
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
          );
          const listData = await listRes.json();
          const found = (listData.channels || []).find(
            (c: { name: string; id: string }) => c.name === channelInput.replace(/^#/, "")
          );
          channelId = found?.id || "";
        }
        if (!channelId) return `Channel "${channelInput}" not found in this workspace.`;

        const res = await fetch(
          `https://slack.com/api/conversations.history?channel=${channelId}&limit=25`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
        );
        const data = await res.json();
        if (!data.ok) return `Slack error: ${data.error}`;

        const messages: Array<{ ts: string; username?: string; user?: string; text?: string }> = (
          data.messages || []
        ).reverse();
        if (messages.length === 0) return `No recent messages in #${channelInput}.`;

        return messages
          .map((m) => {
            const time = new Date(parseFloat(m.ts) * 1000).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });
            const user = m.username || m.user || "unknown";
            return `[${time}] ${user}: ${(m.text || "").slice(0, 300)}`;
          })
          .join("\n");
      } catch (err) {
        return `Failed to read Slack channel: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }

    return "Unknown Slack action.";
  }

  return "That tool isn't available. Let the user know gracefully and redirect to what you can help with.";
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
  tools: Anthropic.Tool[],
  orgEmail: string | undefined,
  onTool: (name: string) => void
): Promise<string> {
  let current = [...messages];

  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: current,
      tools,
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
            tool.input as Record<string, unknown>,
            orgEmail
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

  // Filter tools based on org's disabledTools list
  const disabledTools: string[] = org.disabledTools || [];
  const orgTools = ALL_TOOLS.filter((t) => !disabledTools.includes(t.name));

  // Determine which email to impersonate for Gmail/Calendar.
  // The Steel Hearts service account has domain-wide delegation for steel-hearts.org,
  // so we impersonate the LOGGED-IN user's email when they're on that domain.
  // For other domains the service account can't impersonate, so fall back to any
  // org-level config (e.g. a dedicated service inbox), or leave undefined to disable.
  const session = await auth();
  const sessionEmail = session?.user?.email;
  const orgEmail: string | undefined =
    sessionEmail?.endsWith("@steel-hearts.org")
      ? sessionEmail
      : org.googleWorkspaceEmail;

  // Append build-request tracking instruction to system prompt
  const BUILD_REQUEST_SUFFIX = `

---
PLATFORM INSTRUCTION: When a user asks for something you genuinely cannot do due to platform limitations (a tool not available, a feature that doesn't exist, an integration not configured), emit a build request block at the very start of your response — before any other text:
\`\`\`build_request
{"description":"<concise description of what the user wanted>","requested_by_org":"${orgId}","priority":"medium","source":"chat"}
\`\`\`
These blocks are automatically stripped before the user sees your reply and logged for the platform admin. Only emit this when you truly cannot fulfill the request due to platform capabilities — not when you're choosing not to do something.`;

  const systemPrompt = org.systemPrompt + BUILD_REQUEST_SUFFIX;

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
          systemPrompt,
          orgTools,
          orgEmail,
          (toolName) => {
            toolsUsed.push(toolName);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ tool: toolName })}\n\n`
              )
            );
          }
        );

        // Extract and strip build_request blocks before sending to user
        const buildRequestRe = /```build_request\n([\s\S]*?)```\n?/g;
        const buildRequests: Record<string, unknown>[] = [];
        for (const match of fullText.matchAll(buildRequestRe)) {
          try {
            buildRequests.push(JSON.parse(match[1].trim()));
          } catch {
            /* skip malformed */
          }
        }
        // Remove build_request blocks from visible text
        const cleanText = fullText.replace(buildRequestRe, "").trim();

        // Persist build requests: Supabase first, local fs as fallback
        for (const br of buildRequests) {
          saveBuildQueueItem({
            description: (br.description as string) || "Unmet user request",
            requested_by_org: (br.requested_by_org as string) || orgId,
            priority: (br.priority as string) || "medium",
            status: "backlog",
            source: "chat",
            notes: null,
          });
          saveBuildRequest(orgId, br); // local fallback for dev
        }

        // Persist to Supabase (fire-and-forget)
        const lastUserMsg = messages[messages.length - 1];
        if (lastUserMsg) {
          saveMessage(orgId, "user", lastUserMsg.content);
        }
        saveMessage(orgId, "assistant", cleanText);

        // Also persist locally for dev
        const updatedMessages = [
          ...messages,
          { role: "assistant", content: cleanText },
        ];
        saveLocalConversation(orgId, updatedMessages);

        // Emit text as a single chunk (agentic responses don't stream char-by-char)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: cleanText })}\n\n`)
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
