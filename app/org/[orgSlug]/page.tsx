// Server component — no "use client".
// Auth flow:
//   1. middleware.ts redirects unauthenticated visitors to /login?callbackUrl=/org/[slug]
//   2. This page double-checks the session (belt-and-suspenders)
//   3. Superadmins (role === "superadmin") bypass the org_members check
//   4. Everyone else must be in org_members for this orgSlug; if not → access denied

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrgById } from "@/config/orgs/index.js";
import { checkOrgMember } from "@/lib/supabase";
import ChatApp from "@/app/components/ChatApp";

export default async function OrgPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await auth();

  if (!session) {
    redirect(`/login?callbackUrl=/org/${orgSlug}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org = getOrgById(orgSlug ?? "") as any;

  if (!org) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-app-bg gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
          <span className="text-gray-500 text-lg font-bold">H</span>
        </div>
        <p className="text-white text-sm font-medium">Organization not found</p>
        <p className="text-gray-500 text-xs">Check the URL or contact your HonorBase admin.</p>
      </div>
    );
  }

  // Superadmins can access any org without an org_members row.
  const isSuperAdmin = session.userConfig?.role === "superadmin";

  if (!isSuperAdmin) {
    const email = session.user?.email ?? "";
    const isMember = email ? await checkOrgMember(orgSlug, email) : false;

    if (!isMember) {
      return (
        <div className="flex flex-col items-center justify-center h-dvh bg-app-bg gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
            <span className="text-gray-500 text-lg font-bold">H</span>
          </div>
          <p className="text-white text-sm font-medium">Access denied</p>
          <p className="text-gray-500 text-xs">
            Your account doesn&apos;t have access to{" "}
            {org.orgName ?? orgSlug}.
          </p>
          <p className="text-gray-600 text-xs">
            Contact your administrator to request access.
          </p>
        </div>
      );
    }
  }

  return (
    <ChatApp
      orgId={org.orgId ?? orgSlug}
      greeting={org.greeting ?? `Welcome — ${org.orgName ?? orgSlug} Operator is ready.`}
      accentColor={org.accentColor ?? "#c5a55a"}
      orgName={org.orgName}
    />
  );
}
