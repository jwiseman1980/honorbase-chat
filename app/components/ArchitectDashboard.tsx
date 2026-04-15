"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Priority = "high" | "medium" | "low";
type Status = "backlog" | "in-progress" | "done";
type Source = "chat" | "manual";
type HealthStatus = "ok" | "warning" | "error";

interface BuildQueueItem {
  id: string;
  description: string;
  requested_by_org: string | null;
  priority: Priority;
  status: Status;
  source: Source;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface OrgStat {
  totalMessages: number;
  messagesThisWeek: number;
  lastActive: string | null;
}

interface SystemHealthItem {
  status: HealthStatus;
  message: string;
}

interface ArchitectData {
  buildQueue: BuildQueueItem[];
  orgStats: Record<string, OrgStat>;
  systemHealth: Record<string, SystemHealthItem>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<Priority, string> = {
  high: "bg-red-500/15 text-red-400 border border-red-500/25",
  medium: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25",
  low: "bg-gray-500/15 text-gray-400 border border-gray-500/25",
};

const STATUS_STYLES: Record<Status, string> = {
  backlog: "bg-gray-500/15 text-gray-400 border border-gray-500/25",
  "in-progress": "bg-blue-500/15 text-blue-400 border border-blue-500/25",
  done: "bg-green-500/15 text-green-400 border border-green-500/25",
};

const STATUS_NEXT: Record<Status, Status> = {
  backlog: "in-progress",
  "in-progress": "done",
  done: "backlog",
};

const STATUS_LABEL: Record<Status, string> = {
  backlog: "backlog",
  "in-progress": "in progress",
  done: "done",
};

const ORG_LABELS: Record<string, { label: string; color: string }> = {
  drmf: { label: "DRMF", color: "#c5a55a" },
  "steel-hearts": { label: "Steel Hearts", color: "#dc2626" },
  platform: { label: "Platform", color: "#6366f1" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(iso);
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
      {children}
    </h2>
  );
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function OrgDot({ orgId }: { orgId: string | null }) {
  const org = orgId ? (ORG_LABELS[orgId] ?? { label: orgId, color: "#6b7280" }) : null;
  if (!org) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: org.color }} />
      <span className="text-gray-400 text-xs">{org.label}</span>
    </span>
  );
}

function HealthDot({ status }: { status: HealthStatus }) {
  const color =
    status === "ok"
      ? "bg-green-400"
      : status === "warning"
      ? "bg-yellow-400"
      : "bg-red-500";
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

// ── Add Item Form ─────────────────────────────────────────────────────────────

function AddItemForm({
  onSave,
  onCancel,
}: {
  onSave: (item: {
    description: string;
    requested_by_org: string | null;
    priority: Priority;
    notes: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [desc, setDesc] = useState("");
  const [org, setOrg] = useState("drmf");
  const [priority, setPriority] = useState<Priority>("medium");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!desc.trim()) return;
    setSaving(true);
    await onSave({
      description: desc.trim(),
      requested_by_org: org || null,
      priority,
      notes: notes.trim() || null,
    });
    setSaving(false);
  };

  return (
    <div className="mb-4 p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20">
      <p className="text-xs text-indigo-400 font-medium mb-3">New build item</p>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="What needs to be built..."
        rows={2}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-indigo-500/40 resize-none mb-3"
        autoFocus
      />
      <div className="flex gap-2 mb-3">
        <select
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500/40"
        >
          <option value="drmf">DRMF</option>
          <option value="steel-hearts">Steel Hearts</option>
          <option value="platform">Platform</option>
          <option value="">No org</option>
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500/40"
        >
          <option value="high">High priority</option>
          <option value="medium">Medium priority</option>
          <option value="low">Low priority</option>
        </select>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={1}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-indigo-500/40 resize-none mb-3"
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!desc.trim() || saving}
          className="px-4 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white text-sm font-medium transition-colors"
        >
          {saving ? "Saving..." : "Add to queue"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Build Queue Section ───────────────────────────────────────────────────────

function BuildQueueSection({
  items,
  onStatusChange,
  onPriorityChange,
  onDelete,
  onAdd,
}: {
  items: BuildQueueItem[];
  onStatusChange: (item: BuildQueueItem, next: Status) => void;
  onPriorityChange: (item: BuildQueueItem, next: Priority) => void;
  onDelete: (id: string) => void;
  onAdd: (item: {
    description: string;
    requested_by_org: string | null;
    priority: Priority;
    notes: string | null;
  }) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"all" | Status>("all");

  const filtered =
    filter === "all" ? items : items.filter((i) => i.status === filter);

  const counts = {
    backlog: items.filter((i) => i.status === "backlog").length,
    "in-progress": items.filter((i) => i.status === "in-progress").length,
    done: items.filter((i) => i.status === "done").length,
  };

  const handleAdd = async (newItem: Parameters<typeof onAdd>[0]) => {
    await onAdd(newItem);
    setShowForm(false);
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <SectionHeader>Build Queue</SectionHeader>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add item
        </button>
      </div>

      {showForm && (
        <AddItemForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3">
        {(["all", "backlog", "in-progress", "done"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              filter === f
                ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {f === "all" ? `All (${items.length})` : `${STATUS_LABEL[f]} (${counts[f]})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-gray-600 text-sm">
            {filter === "all" ? "No build items yet." : `Nothing in ${STATUS_LABEL[filter as Status]}.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((item) => (
            <BuildQueueRow
              key={item.id}
              item={item}
              onStatusChange={onStatusChange}
              onPriorityChange={onPriorityChange}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BuildQueueRow({
  item,
  onStatusChange,
  onPriorityChange,
  onDelete,
}: {
  item: BuildQueueItem;
  onStatusChange: (item: BuildQueueItem, next: Status) => void;
  onPriorityChange: (item: BuildQueueItem, next: Priority) => void;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const nextPriority: Priority =
    item.priority === "high" ? "medium" : item.priority === "medium" ? "low" : "high";

  return (
    <div
      className={`p-3 rounded-xl border transition-colors ${
        item.status === "done"
          ? "bg-white/2 border-white/5 opacity-60"
          : "bg-white/5 border-white/10"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-2">
        {/* Priority badge — click to cycle */}
        <button
          onClick={() => onPriorityChange(item, nextPriority)}
          title="Click to change priority"
          className={`flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-80 ${PRIORITY_STYLES[item.priority]}`}
        >
          {item.priority}
        </button>

        <div className="flex-1 min-w-0">
          <p
            className={`text-sm leading-snug ${
              item.status === "done" ? "text-gray-500 line-through" : "text-white"
            }`}
          >
            {item.description}
          </p>
          {item.notes && (
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">{item.notes}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <OrgDot orgId={item.requested_by_org} />
            {item.source === "chat" && (
              <span className="flex items-center gap-1 text-[10px] text-gray-600">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                from chat
              </span>
            )}
            <span className="text-[10px] text-gray-600">{formatRelative(item.created_at)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Status badge — click to cycle */}
          <button
            onClick={() => onStatusChange(item, STATUS_NEXT[item.status])}
            title="Click to advance status"
            className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-opacity hover:opacity-80 ${STATUS_STYLES[item.status]}`}
          >
            {STATUS_LABEL[item.status]}
          </button>

          {/* Delete button (shows on hover) */}
          <button
            onClick={() => onDelete(item.id)}
            className={`w-6 h-6 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all ${
              hovered ? "opacity-100" : "opacity-0"
            }`}
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Org Overview Section ──────────────────────────────────────────────────────

function OrgOverviewSection({ orgStats }: { orgStats: Record<string, OrgStat> }) {
  const orgs = [
    { id: "drmf", name: "Drew Ross Memorial Foundation", shortName: "DRMF", color: "#c5a55a" },
    { id: "steel-hearts", name: "Steel Hearts Foundation", shortName: "Steel Hearts", color: "#dc2626" },
  ];

  return (
    <section className="mb-6">
      <SectionHeader>Org Overview</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {orgs.map((org) => {
          const stats = orgStats[org.id];
          return (
            <div
              key={org.id}
              className="p-4 rounded-2xl bg-white/5 border border-white/10"
            >
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-2 h-8 rounded-full flex-shrink-0"
                  style={{ backgroundColor: org.color }}
                />
                <div>
                  <p className="text-white text-sm font-medium">{org.shortName}</p>
                  <p className="text-gray-500 text-xs">{org.name}</p>
                </div>
              </div>
              {stats ? (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-white text-xl font-semibold tabular-nums">
                      {stats.totalMessages}
                    </p>
                    <p className="text-gray-500 text-[11px]">total msgs</p>
                  </div>
                  <div>
                    <p className="text-white text-xl font-semibold tabular-nums">
                      {stats.messagesThisWeek}
                    </p>
                    <p className="text-gray-500 text-[11px]">this week</p>
                  </div>
                  <div>
                    <p className="text-gray-300 text-sm font-medium">
                      {formatRelative(stats.lastActive)}
                    </p>
                    <p className="text-gray-500 text-[11px]">last active</p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-600 text-sm">No data</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Usage Signals Section ─────────────────────────────────────────────────────

function UsageSignalsSection({
  orgStats,
  buildQueue,
}: {
  orgStats: Record<string, OrgStat>;
  buildQueue: BuildQueueItem[];
}) {
  const chatRequests = buildQueue.filter((i) => i.source === "chat");
  const totalMsgs = Object.values(orgStats).reduce((s, o) => s + o.totalMessages, 0);
  const weekMsgs = Object.values(orgStats).reduce((s, o) => s + o.messagesThisWeek, 0);

  return (
    <section className="mb-6">
      <SectionHeader>Usage Signals</SectionHeader>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
          <p className="text-white text-2xl font-semibold tabular-nums">{totalMsgs}</p>
          <p className="text-gray-500 text-xs mt-0.5">total messages</p>
          <p className="text-gray-600 text-[10px] mt-1">across all orgs</p>
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
          <p className="text-white text-2xl font-semibold tabular-nums">{weekMsgs}</p>
          <p className="text-gray-500 text-xs mt-0.5">messages this week</p>
          <p className="text-gray-600 text-[10px] mt-1">last 7 days</p>
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
          <p className="text-white text-2xl font-semibold tabular-nums">{chatRequests.length}</p>
          <p className="text-gray-500 text-xs mt-0.5">unmet needs logged</p>
          <p className="text-gray-600 text-[10px] mt-1">from chat signals</p>
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
          <p className="text-white text-2xl font-semibold tabular-nums">
            {buildQueue.filter((i) => i.status !== "done").length}
          </p>
          <p className="text-gray-500 text-xs mt-0.5">items open</p>
          <p className="text-gray-600 text-[10px] mt-1">backlog + in-progress</p>
        </div>
      </div>
      {chatRequests.length > 0 && (
        <div className="mt-3 p-3 rounded-xl bg-white/3 border border-white/5">
          <p className="text-[11px] text-gray-500 mb-2 font-medium uppercase tracking-wide">Recent unmet needs from chat</p>
          <div className="flex flex-col gap-1.5">
            {chatRequests.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-start gap-2">
                <span className="text-[10px] text-gray-600 mt-0.5 flex-shrink-0">
                  {formatRelative(r.created_at)}
                </span>
                <OrgDot orgId={r.requested_by_org} />
                <p className="text-xs text-gray-400 leading-snug">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── System Health Section ─────────────────────────────────────────────────────

function SystemHealthSection({ health }: { health: Record<string, SystemHealthItem> }) {
  return (
    <section className="mb-6">
      <SectionHeader>System Health</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(health).map(([service, info]) => (
          <div
            key={service}
            className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10"
          >
            <HealthDot status={info.status} />
            <div className="min-w-0">
              <p className="text-white text-sm font-medium">{service}</p>
              <p className="text-gray-500 text-xs truncate">{info.message}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function ArchitectDashboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<ArchitectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/architect");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Optimistic status change
  const handleStatusChange = async (item: BuildQueueItem, next: Status) => {
    setData((prev) =>
      prev
        ? { ...prev, buildQueue: prev.buildQueue.map((i) => (i.id === item.id ? { ...i, status: next } : i)) }
        : null
    );
    await fetch("/api/architect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: item.id, fields: { status: next } }),
    });
  };

  // Optimistic priority change
  const handlePriorityChange = async (item: BuildQueueItem, next: Priority) => {
    setData((prev) =>
      prev
        ? { ...prev, buildQueue: prev.buildQueue.map((i) => (i.id === item.id ? { ...i, priority: next } : i)) }
        : null
    );
    await fetch("/api/architect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: item.id, fields: { priority: next } }),
    });
  };

  const handleDelete = async (id: string) => {
    setData((prev) =>
      prev ? { ...prev, buildQueue: prev.buildQueue.filter((i) => i.id !== id) } : null
    );
    await fetch("/api/architect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
  };

  const handleAdd = async (item: {
    description: string;
    requested_by_org: string | null;
    priority: Priority;
    notes: string | null;
  }) => {
    const res = await fetch("/api/architect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", item: { ...item, source: "manual" } }),
    });
    const json = await res.json();
    if (json.item) {
      setData((prev) =>
        prev ? { ...prev, buildQueue: [json.item, ...prev.buildQueue] } : null
      );
    }
  };

  return (
    <div className="flex flex-col h-dvh bg-app-bg overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <span className="text-indigo-400 text-[9px] font-bold">A</span>
            </div>
            <span className="text-gray-300 text-sm font-medium">HonorBase Architect</span>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <svg
            className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-8">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <p className="text-red-400 text-sm mb-2">{error}</p>
            <button
              onClick={() => load()}
              className="text-gray-400 hover:text-white text-xs underline"
            >
              Try again
            </button>
          </div>
        ) : data ? (
          <>
            <BuildQueueSection
              items={data.buildQueue}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              onDelete={handleDelete}
              onAdd={handleAdd}
            />
            <OrgOverviewSection orgStats={data.orgStats} />
            <UsageSignalsSection orgStats={data.orgStats} buildQueue={data.buildQueue} />
            <SystemHealthSection health={data.systemHealth} />
          </>
        ) : null}
      </div>
    </div>
  );
}
