"use client";

import { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
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

// ─── Not-authenticated screen ─────────────────────────────────────────────────
function SignInScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-app-bg px-8">
      <div className="w-full max-w-xs text-center">
        <div className="w-14 h-14 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center mx-auto mb-5">
          <span className="text-gold text-xl font-bold">H</span>
        </div>
        <h1 className="text-white text-lg font-semibold mb-1">HonorBase Operator</h1>
        <p className="text-gray-500 text-sm mb-8">AI operations for mission-driven orgs</p>
        <button
          onClick={() => signIn("google")}
          className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-2xl bg-white hover:bg-gray-100 transition-colors text-gray-900 text-sm font-medium"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05" />
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

// ─── No-org screen (authenticated but not provisioned) ────────────────────────
function NoOrgScreen({ email }: { email?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-app-bg px-8">
      <div className="w-full max-w-xs text-center">
        <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
          <span className="text-gray-500 text-xl font-bold">H</span>
        </div>
        <h1 className="text-white text-base font-semibold mb-2">You&apos;re not set up yet</h1>
        {email && <p className="text-gray-600 text-xs mb-3">Signed in as {email}</p>}
        <p className="text-gray-500 text-sm">
          Contact your HonorBase administrator to get access to your organization.
        </p>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="mt-8 text-sm text-gray-600 hover:text-gray-400 transition-colors"
        >
          Sign out
        </button>
      </div>
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
  if (status === "unauthenticated") return <SignInScreen />;

  const userConfig = session?.userConfig;
  // Authenticated but not provisioned to any org
  if (!userConfig) return <NoOrgScreen email={session?.user?.email} />;

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
