"use client";

import { useMemo } from "react";

export type Card =
  | { type: "countdown"; id: string; title: string; date: string }
  | {
      type: "metric";
      id: string;
      title: string;
      value: number;
      total?: number;
    }
  | {
      type: "list";
      id: string;
      title: string;
      items: { label: string; done: boolean }[];
    }
  | { type: "note"; id: string; title: string; content: string };

function CountdownCard({ card }: { card: Extract<Card, { type: "countdown" }> }) {
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(card.date);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }, [card.date]);

  return (
    <div className="dashboard-card flex flex-col items-center justify-center min-w-[130px]">
      <div className="text-4xl font-bold text-gold leading-none">{days}</div>
      <div className="text-xs text-gray-400 mt-1">days away</div>
      <div className="text-xs text-gray-300 mt-2 font-medium text-center leading-tight">{card.title}</div>
    </div>
  );
}

function MetricCard({ card }: { card: Extract<Card, { type: "metric" }> }) {
  const pct = card.total ? (card.value / card.total) * 100 : null;
  return (
    <div className="dashboard-card flex flex-col justify-between min-w-[130px]">
      <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">{card.title}</div>
      <div className="mt-2">
        <span className="text-3xl font-bold text-white">{card.value}</span>
        {card.total !== undefined && (
          <span className="text-sm text-gray-500 ml-1">/ {card.total}</span>
        )}
      </div>
      {pct !== null && (
        <div className="mt-3 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: "#c5a55a" }}
          />
        </div>
      )}
    </div>
  );
}

function ListCard({ card }: { card: Extract<Card, { type: "list" }> }) {
  const done = card.items.filter((i) => i.done).length;
  return (
    <div className="dashboard-card min-w-[180px] max-w-[220px]">
      <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2 flex justify-between">
        <span>{card.title}</span>
        <span className="text-gold">{done}/{card.items.length}</span>
      </div>
      <ul className="space-y-1.5">
        {card.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center ${item.done ? "border-gold bg-gold/20" : "border-gray-600"}`}>
              {item.done && (
                <svg viewBox="0 0 10 10" className="w-2 h-2 text-gold fill-current">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span className={item.done ? "text-gray-500 line-through" : "text-gray-200"}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteCard({ card }: { card: Extract<Card, { type: "note" }> }) {
  return (
    <div className="dashboard-card min-w-[160px] max-w-[200px]">
      <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2">{card.title}</div>
      <p className="text-xs text-gray-200 leading-relaxed">{card.content}</p>
    </div>
  );
}

export default function DashboardCard({ card }: { card: Card }) {
  switch (card.type) {
    case "countdown": return <CountdownCard card={card} />;
    case "metric": return <MetricCard card={card} />;
    case "list": return <ListCard card={card} />;
    case "note": return <NoteCard card={card} />;
  }
}
