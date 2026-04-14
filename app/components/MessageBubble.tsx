"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type MessageContent =
  | string
  | Array<{
      type: "text" | "image" | "file";
      text?: string;
      data?: string;
      mediaType?: string;
      filename?: string;
      previewUrl?: string;
    }>;

export interface Message {
  role: "user" | "assistant";
  content: MessageContent;
}

function ImageThumb({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="max-w-[220px] max-h-[180px] rounded-xl object-cover border border-white/10"
    />
  );
}

function FileAttachment({ filename }: { filename: string }) {
  const ext = filename.split(".").pop()?.toUpperCase() ?? "FILE";
  return (
    <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2 text-sm">
      <div className="w-8 h-8 rounded-lg bg-gold/20 flex items-center justify-center text-[10px] font-bold text-gold">
        {ext}
      </div>
      <span className="text-gray-200 truncate max-w-[140px]">{filename}</span>
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  // Strip dashboard blocks from visible text
  const cleaned = text.replace(/```dashboard[\s\S]*?```/g, "").trim();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-gold">{children}</strong>,
        a: ({ children, href }) => (
          <a href={href} className="text-gold underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="bg-black/30 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="bg-black/30 rounded-xl p-3 text-xs overflow-x-auto my-2">{children}</pre>
        ),
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  const renderContent = () => {
    if (typeof message.content === "string") {
      if (isUser) return <p className="text-sm">{message.content}</p>;
      return <AssistantText text={message.content} />;
    }

    return (
      <div className="flex flex-col gap-2">
        {message.content.map((part, i) => {
          if (part.type === "text" && part.text) {
            if (isUser) return <p key={i} className="text-sm">{part.text}</p>;
            return <AssistantText key={i} text={part.text} />;
          }
          if (part.type === "image" && part.previewUrl) {
            return <ImageThumb key={i} src={part.previewUrl} alt="attached image" />;
          }
          if (part.type === "image" && part.data) {
            return (
              <ImageThumb
                key={i}
                src={`data:${part.mediaType};base64,${part.data}`}
                alt="attached image"
              />
            );
          }
          if (part.type === "file" && part.filename) {
            return <FileAttachment key={i} filename={part.filename} />;
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center mr-2 flex-shrink-0 mt-1">
          <span className="text-gold text-xs font-bold">H</span>
        </div>
      )}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-user-bubble text-white rounded-br-sm"
            : "bg-assistant-bubble text-gray-100 rounded-bl-sm"
        }`}
      >
        {renderContent()}
      </div>
    </div>
  );
}
