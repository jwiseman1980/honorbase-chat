import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getOrgById } from "@/config/orgs/drmf";
import fs from "fs";
import path from "path";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function getConversationPath(orgId: string) {
  return path.join(process.cwd(), "data", "conversations", `${orgId}.json`);
}

function loadConversation(orgId: string) {
  const filePath = getConversationPath(orgId);
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveConversation(orgId: string, messages: unknown[]) {
  const filePath = getConversationPath(orgId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, orgId } = body;

  const org = getOrgById(orgId);
  if (!org) {
    return new Response(JSON.stringify({ error: "Unknown org" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build Anthropic-format messages from incoming messages
  // Messages may contain text and/or image content
  const anthropicMessages = messages.map(
    (msg: {
      role: string;
      content:
        | string
        | Array<{ type: string; text?: string; data?: string; mediaType?: string; filename?: string }>;
    }) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }

      // Multi-part content (text + images)
      const parts = msg.content.map(
        (part: { type: string; text?: string; data?: string; mediaType?: string; filename?: string }) => {
          if (part.type === "text") return { type: "text", text: part.text };
          if (part.type === "image") {
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: part.mediaType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: part.data,
              },
            };
          }
          if (part.type === "file") {
            return {
              type: "text",
              text: `[Attached file: ${part.filename}]`,
            };
          }
          return { type: "text", text: "" };
        }
      );

      return { role: msg.role, content: parts };
    }
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";

      try {
        const anthropicStream = await client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: org.systemPrompt,
          messages: anthropicMessages,
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = event.delta.text;
            fullText += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
            );
          }
        }

        // Parse and store build_request blocks server-side
        const buildMatches = fullText.matchAll(/```build_request\n([\s\S]*?)```/g);
        for (const match of buildMatches) {
          try {
            const req = JSON.parse(match[1].trim());
            const brPath = path.join(process.cwd(), "data", "build_requests", `${orgId}.json`);
            let brs: unknown[] = [];
            try { brs = JSON.parse(fs.readFileSync(brPath, "utf-8")); } catch { /* empty */ }
            brs.unshift({
              id: `br-${Date.now()}`,
              ...req,
              status: "pending",
            });
            fs.writeFileSync(brPath, JSON.stringify(brs, null, 2));
          } catch { /* skip malformed */ }
        }

        // Save conversation after completion
        const updatedMessages = [
          ...messages,
          { role: "assistant", content: fullText },
        ];
        saveConversation(orgId, updatedMessages);

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
      } catch (err) {
        console.error("Stream error:", err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Stream failed" })}\n\n`
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
  const messages = loadConversation(orgId);
  return new Response(JSON.stringify(messages), {
    headers: { "Content-Type": "application/json" },
  });
}
