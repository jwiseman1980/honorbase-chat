"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import DashboardCard, { Card } from "./components/DashboardCard";
import MessageBubble, { Message, MessageContent } from "./components/MessageBubble";
import TypingIndicator from "./components/TypingIndicator";

// ─── Dashboard block parser ───────────────────────────────────────────────────
function parseDashboardBlocks(text: string): { blocks: (Card & { action?: string })[] } {
  const blocks: (Card & { action?: string })[] = [];
  text.replace(/```dashboard\n([\s\S]*?)```/g, (_, json) => {
    try {
      blocks.push(JSON.parse(json.trim()));
    } catch {
      /* ignore malformed */
    }
    return "";
  });
  return { blocks };
}

// ─── No-token screen ─────────────────────────────────────────────────────────
function NoAccess() {
  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-app-bg text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center mb-6">
        <span className="text-gold text-2xl font-bold">H</span>
      </div>
      <h1 className="text-white text-xl font-semibold mb-2">HonorBase Operator</h1>
      <p className="text-gray-400 text-sm leading-relaxed max-w-xs">
        Contact{" "}
        <a href="mailto:hello@honorbase.app" className="text-gold underline">
          hello@honorbase.app
        </a>{" "}
        to get started.
      </p>
    </div>
  );
}

// ─── Attachment preview (before sending) ─────────────────────────────────────
interface PendingAttachment {
  type: "image" | "file";
  filename: string;
  previewUrl?: string;
  data?: string;
  mediaType?: string;
}

function AttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (i: number) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex gap-2 flex-wrap px-3 pt-2">
      {attachments.map((att, i) => (
        <div key={i} className="relative">
          {att.type === "image" && att.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={att.previewUrl}
              alt={att.filename}
              className="w-16 h-16 object-cover rounded-xl border border-white/10"
            />
          ) : (
            <div className="flex items-center gap-1.5 bg-white/10 rounded-xl px-2 py-1.5 text-xs text-gray-300">
              <span className="text-gold font-bold text-[10px]">
                {att.filename.split(".").pop()?.toUpperCase()}
              </span>
              <span className="max-w-[80px] truncate">{att.filename}</span>
            </div>
          )}
          <button
            onClick={() => onRemove(i)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-700 rounded-full flex items-center justify-center text-gray-300 hover:text-white text-[10px]"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main chat page ───────────────────────────────────────────────────────────
function ChatApp({ orgId }: { orgId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load conversation + dashboard on mount
  useEffect(() => {
    fetch(`/api/chat?orgId=${orgId}`)
      .then((r) => r.json())
      .then((msgs) => setMessages(msgs || []))
      .catch(() => {});

    fetch(`/api/dashboard?orgId=${orgId}`)
      .then((r) => r.json())
      .then((c) => setCards(c || []))
      .catch(() => {});
  }, [orgId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-grow textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  };

  // Apply dashboard card update
  const applyCardAction = useCallback(
    async (action: string, card: Card) => {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, action, card }),
      });
      const updated = await res.json();
      setCards(updated);
    },
    [orgId]
  );

  // Handle file/image selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploading(true);
    const newAttachments: PendingAttachment[] = [];

    for (const file of files) {
      const isImage = file.type.startsWith("image/");

      if (isImage) {
        // Convert to base64 for Claude vision
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.readAsDataURL(file);
        });
        const previewUrl = `data:${file.type};base64,${base64}`;
        newAttachments.push({
          type: "image",
          filename: file.name,
          previewUrl,
          data: base64,
          mediaType: file.type,
        });
      } else {
        // Upload non-image files to server
        const form = new FormData();
        form.append("file", file);
        form.append("orgId", orgId);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const json = await res.json();
        newAttachments.push({
          type: "file",
          filename: file.name,
          savedAs: json.savedAs,
          filePath: json.path,
        } as PendingAttachment);
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (i: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && !attachments.length) return;
    if (streaming) return;

    // Build content for this user message
    let userContent: MessageContent;
    if (!attachments.length) {
      userContent = text;
    } else {
      const parts: Array<{ type: string; text?: string; data?: string; mediaType?: string; filename?: string; previewUrl?: string }> = [];
      for (const att of attachments) {
        if (att.type === "image") {
          parts.push({
            type: "image",
            data: att.data,
            mediaType: att.mediaType,
            previewUrl: att.previewUrl,
          });
        } else {
          parts.push({ type: "file", filename: att.filename });
        }
      }
      if (text) parts.push({ type: "text", text });
      userContent = parts as MessageContent;
    }

    const userMsg: Message = { role: "user", content: userContent };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setAttachments([]);
    setStreaming(true);
    setStreamingText("");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages, orgId }),
      });

      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              accumulated += data.text;
              setStreamingText(accumulated);
            }
            if (data.done) {
              const { blocks } = parseDashboardBlocks(accumulated);
              for (const block of blocks) {
                const { action, ...card } = block;
                await applyCardAction(action ?? "add", card as Card);
              }
              const assistantMsg: Message = {
                role: "assistant",
                content: accumulated,
              };
              setMessages([...updatedMessages, assistantMsg]);
              setStreamingText("");
              setStreaming(false);
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch {
      setStreaming(false);
      setStreamingText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-dvh bg-app-bg overflow-hidden">
      {/* ── Dashboard ── */}
      {cards.length > 0 && (
        <div className="flex-shrink-0 border-b border-white/5 bg-dashboard-bg">
          <div className="flex gap-3 overflow-x-auto px-4 py-3 scrollbar-hide snap-x snap-mandatory">
            {cards.map((card) => (
              <div key={card.id} className="snap-start flex-shrink-0">
                <DashboardCard card={card} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center pb-8">
            <div className="w-14 h-14 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center mb-4">
              <span className="text-gold text-xl font-bold">H</span>
            </div>
            <p className="text-gray-400 text-sm max-w-xs">
              Hi Sarah — I&apos;m your DRMF Operator. Ask me anything about the Ruck &amp; Roll, or just say hi.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {streaming && !streamingText && <TypingIndicator />}
        {streaming && streamingText && (
          <MessageBubble
            message={{ role: "assistant", content: streamingText }}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="flex-shrink-0 border-t border-white/5 bg-input-bg px-3 pb-safe">
        <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />

        <div className="flex items-end gap-2 py-3">
          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex-shrink-0 w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors disabled:opacity-50"
            aria-label="Attach file"
          >
            {uploading ? (
              <svg className="w-4 h-4 text-gray-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
          </button>

          {/* Hidden file input — supports camera capture on mobile */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Message DRMF Operator..."
            rows={1}
            className="flex-1 resize-none bg-input-field rounded-2xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none border border-white/5 focus:border-gold/30 transition-colors leading-relaxed max-h-40"
          />

          {/* Send button */}
          <button
            onClick={sendMessage}
            disabled={streaming || (!input.trim() && !attachments.length)}
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-30"
            style={{
              backgroundColor:
                streaming || (!input.trim() && !attachments.length)
                  ? "rgba(197,165,90,0.2)"
                  : "#c5a55a",
            }}
            aria-label="Send"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>

        <p className="text-center text-[10px] text-gray-600 pb-2">
          Powered by HonorBase
        </p>
      </div>
    </div>
  );
}

// ─── Token gate ───────────────────────────────────────────────────────────────
const VALID_TOKENS: Record<string, string> = {
  "drmf-2026-sarah": "drmf",
};

function ChatGate() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const orgId = VALID_TOKENS[token];

  if (!orgId) return <NoAccess />;
  return <ChatApp orgId={orgId} />;
}

export default function Page() {
  return (
    <Suspense>
      <ChatGate />
    </Suspense>
  );
}
