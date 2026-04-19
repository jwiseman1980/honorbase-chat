import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// ─── User whitelist ───────────────────────────────────────────────────────────
// Maps email → org config. Add new users here.
// orgId: "all" means superadmin (sees org picker)
const WHITELIST = {
  "joseph.wiseman@steel-hearts.org": {
    name: "Joseph Wiseman",
    orgId: "all" as const,
    role: "superadmin" as const,
    greeting: "Hi Joseph — Platform Admin",
    accentColor: "#c5a55a",
  },
  "kristin.hughes@steel-hearts.org": {
    name: "Kristin Hughes",
    orgId: "steel-hearts" as const,
    role: "shipping" as const,
    greeting: "Hi Kristin — your Steel Hearts Operator is ready. What do you need?",
    accentColor: "#dc2626",
  },
  "sarah@drewross.org": {
    name: "Sarah Ross Geisen",
    orgId: "drmf" as const,
    role: "executive-director" as const,
    greeting: "Hi Sarah — I know your org, I know what's coming up. What do you need help with most right now?",
    accentColor: "#c5a55a",
  },
} as const;

export type WhitelistEntry = (typeof WHITELIST)[keyof typeof WHITELIST];

// Extend NextAuth types
declare module "next-auth" {
  interface Session {
    userConfig: WhitelistEntry;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    signIn({ user }) {
      // Allow any Google account — access control is handled per-request via org_members
      return !!user.email;
    },
    jwt({ token, user }) {
      // Always re-read from whitelist so config changes take effect without re-login
      const email = (user?.email ?? token.email) as string | undefined;
      if (email && email in WHITELIST) {
        token.userConfig = WHITELIST[email as keyof typeof WHITELIST];
        token.email = email;
      }
      return token;
    },
    session({ session, token }) {
      if (token.userConfig) {
        session.userConfig = token.userConfig as WhitelistEntry;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
