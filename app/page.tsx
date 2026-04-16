"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import ChatApp from "./components/ChatApp";
import ArchitectDashboard from "./components/ArchitectDashboard";

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
        orgName={adminOrgConfig?.name}
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
