"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import DashboardCard, { Card } from "./components/DashboardCard";
import MessageBubble, { Message, MessageContent } from "./components/MessageBubble";
import TypingIndicator from "./components/TypingIndicator";
import ArchitectDashboard from "./components/ArchitectDashboard";

// ─── Dashboard block parser ───────────────────────────────────────────────────
function parseDashboardBlocks(text: string): { blocks: (Card & { action?: string })[] } {
  const blocks: (Card & { action?: string })[] = [];
  text.replace(/```dashboard\n([\s\S]*?)```/g, (_, json) => {
    try { blocks.push(JSON.parse(json.trim())); } catch { /* ignore */ }
    return "";
  });
  return { blocks };
}

// ─── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-dvh bg-app-bg">
      <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
    </div>
  );
}

// ─── Admin org picker ─────────────────────────────────────────────────────────
const ADMIN_ORGS = [
  {
    id: "drmf",
    name: "Drew Ross Memorial Foundation",
    subtitle: "Joseph Wiseman · Platform Admin",
    adminGreeting: "Joseph Wiseman · Platform Admin — DRMF workspace",
    color: "#c5a55a",
  },
  {
    id: "steel-hearts",
    name: "Steel Hearts Foundation",
    subtitle: "Joseph Wiseman · Founder",
    adminGreeting: "Joseph Wiseman · Founder & Platform Admin",
    color: "#dc2626",
  },
  {
    id: "honorbase",
    name: "HonorBase Platform",
    subtitle: "Joseph Wiseman · Architect",
    adminGreeting: "Joseph Wiseman · Architect",
    color: "#6366f1",
  },
];

function AdminPicker({ onSelect }: { onSelect: (orgId: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-app-bg px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center">
              <span className="text-gold text-lg font-bold">H</span>
            </div>
            <div>
              <h1 className="text-white text-base font-semibold">HonorBase Admin</h1>
              <p className="text-gray-500 text-xs">Joseph Wiseman · Platform Admin</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-gray-600 hover:text-gray-400 text-xs transition-colors"
          >
            Sign out
          </button>
        </div>
        <p className="text-gray-400 text-sm mb-6">Select an organization:</p>
        <div className="flex flex-col gap-3">
          {ADMIN_ORGS.map((org) => (
            <button
              key={org.id}
              onClick={() => onSelect(org.id)}
              className="w-full text-left p-4 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-2 h-8 rounded-full flex-shrink-0"
                  style={{ backgroundColor: org.color }}
                />
                <div>
                  <p className="text-white text-sm font-medium">{org.name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{org.subtitle}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Attachment preview ───────────────────────────────────────────────────────
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
            <img src={att.previewUrl} alt={att.filename}
              className="w-16 h-16 object-cover rounded-xl border border-white/10" />
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
          >×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Main chat app ────────────────────────────────────────────────────────────
function ChatApp({
  orgId,
  greeting,
  accentColor,
  onBack,
}: {
  orgId: string;
  greeting: string;
  accentColor: string;
  onBack?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, toolStatus]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  };

  const applyCardAction = useCallback(
    async (action: string, card: Card) => {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, action, card }),
      });
      setCards(await res.json());
    },
    [orgId]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    const newAtts: PendingAttachment[] = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(file);
        });
        newAtts.push({
          type: "image",
          filename: file.name,
          previewUrl: `data:${file.type};base64,${base64}`,
          data: base64,
          mediaType: file.type,
        });
      } else {
        const form = new FormData();
        form.append("file", file);
        form.append("orgId", orgId);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const json = await res.json();
        newAtts.push({ type: "file", filename: file.name, ...json } as PendingAttachment);
      }
    }
    setAttachments((prev) => [...prev, ...newAtts]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && !attachments.length) return;
    if (streaming) return;

    let userContent: MessageContent;
    if (!attachments.length) {
      userContent = text;
    } else {
      const parts: Array<{ type: string; text?: string; data?: string; mediaType?: string; filename?: string; previewUrl?: string }> = [];
      for (const att of attachments) {
        if (att.type === "image") {
          parts.push({ type: "image", data: att.data, mediaType: att.mediaType, previewUrl: att.previewUrl });
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
    setToolStatus(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

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
        for (const line of decoder.decode(value).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.tool) {
              setToolStatus(
                data.tool === "web_search" ? "Searching the web..." : "Reading page..."
              );
            }
            if (data.text) {
              accumulated += data.text;
              setStreamingText(accumulated);
              setToolStatus(null);
            }
            if (data.done) {
              const { blocks } = parseDashboardBlocks(accumulated);
              for (const block of blocks) {
                const { action, ...card } = block;
                await applyCardAction(action ?? "add", card as Card);
              }
              setMessages([...updatedMessages, { role: "assistant", content: accumulated }]);
              setStreamingText("");
              setStreaming(false);
              setToolStatus(null);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch {
      setStreaming(false);
      setStreamingText("");
      setToolStatus(null);
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
      {/* ── Top bar (admin back button) ── */}
      {onBack && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-white/5">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All orgs
          </button>
          <span className="text-gray-600 text-sm">·</span>
          <span className="text-gray-400 text-sm">{orgId === "drmf" ? "DRMF" : orgId === "honorbase" ? "HonorBase" : "Steel Hearts"}</span>
        </div>
      )}

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
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border"
              style={{ backgroundColor: `${accentColor}1a`, borderColor: `${accentColor}4d` }}
            >
              <span className="text-xl font-bold" style={{ color: accentColor }}>H</span>
            </div>
            <p className="text-gray-400 text-sm max-w-xs">{greeting}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {streaming && !streamingText && (
          <TypingIndicator label={toolStatus ?? undefined} />
        )}
        {streaming && streamingText && (
          <MessageBubble message={{ role: "assistant", content: streamingText }} />
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="flex-shrink-0 border-t border-white/5 bg-input-bg px-3 pb-safe">
        <AttachmentPreview attachments={attachments} onRemove={(i) =>
          setAttachments((prev) => prev.filter((_, idx) => idx !== i))
        } />
        <div className="flex items-end gap-2 py-3">
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
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${orgId === "drmf" ? "DRMF" : orgId === "honorbase" ? "HonorBase" : "Steel Hearts"} Operator...`}
            rows={1}
            className="flex-1 resize-none bg-input-field rounded-2xl px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none border border-white/5 focus:border-gold/30 transition-colors leading-relaxed max-h-40"
          />
          <button
            onClick={sendMessage}
            disabled={streaming || (!input.trim() && !attachments.length)}
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-30"
            style={{
              backgroundColor:
                streaming || (!input.trim() && !attachments.length)
                  ? `${accentColor}33`
                  : accentColor,
            }}
            aria-label="Send"
          >
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
        <p className="text-center text-[10px] text-gray-600 pb-2">Powered by HonorBase</p>
      </div>
    </div>
  );
}

// ─── HonorBase Platform — Architect Dashboard ─────────────────────────────────
// (component imported from ./components/ArchitectDashboard)

// ─── Session-based gate ───────────────────────────────────────────────────────

function ChatGate() {
  const { data: session, status } = useSession();
  const [adminOrg, setAdminOrg] = useState<string | null>(null);

  if (status === "loading") return <LoadingScreen />;

  const userConfig = session?.userConfig;
  if (!userConfig) return <LoadingScreen />;

  // Superadmin sees org picker
  if (userConfig.role === "superadmin") {
    if (!adminOrg) return (
      <AdminPicker onSelect={(id) => {
        if (id === "steel-hearts") {
          window.location.href = "https://shos-app.vercel.app";
          return;
        }
        setAdminOrg(id);
      }} />
    );
    if (adminOrg === "honorbase") return <ArchitectDashboard onBack={() => setAdminOrg(null)} />;
    const adminOrgConfig = ADMIN_ORGS.find((o) => o.id === adminOrg)!;
    return (
      <ChatApp
        orgId={adminOrg}
        greeting={adminOrgConfig?.adminGreeting ?? adminOrgConfig?.name ?? ""}
        accentColor={adminOrgConfig?.color ?? "#c5a55a"}
        onBack={() => setAdminOrg(null)}
      />
    );
  }

  // Regular user goes straight to their org
  return (
    <ChatApp
      orgId={userConfig.orgId!}
      greeting={userConfig.greeting}
      accentColor={userConfig.accentColor}
    />
  );
}

export default function Page() {
  return <ChatGate />;
}
