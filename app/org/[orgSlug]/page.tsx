"use client";

import { useParams } from "next/navigation";
import { getOrgById } from "@/config/orgs/index.js";
import ChatApp from "@/app/components/ChatApp";

// Public-facing org chat page — no auth required.
// URL: /org/drmf, /org/steel-hearts, etc.
// The org config (system prompt, tools, branding) is loaded by slug.

export default function OrgPage() {
  const params = useParams();
  const slug = Array.isArray(params.orgSlug)
    ? params.orgSlug[0]
    : (params.orgSlug as string);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const org = getOrgById(slug ?? "") as any;

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

  return (
    <ChatApp
      orgId={org.orgId ?? slug}
      greeting={org.greeting ?? `Welcome — ${org.orgName ?? slug} Operator is ready.`}
      accentColor={org.accentColor ?? "#c5a55a"}
      orgName={org.orgName}
    />
  );
}
