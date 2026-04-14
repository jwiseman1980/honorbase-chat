import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// ─── User whitelist ───────────────────────────────────────────────────────────
// Maps email → org config. Add new users here.
// orgId: null means superadmin (sees org picker)
const WHITELIST = {
  "joseph.wiseman@steel-hearts.org": {
    orgId: null as null,
    role: "superadmin" as const,
    greeting: "Hi Joseph — Platform Admin",
    accentColor: "#c5a55a",
  },
  "kristin.hughes@steel-hearts.org": {
    orgId: "steelhearts",
    role: "fulfillment" as const,
    greeting: "Hi Kristin — your Steel Hearts Operator is ready. What do you need?",
    accentColor: "#dc2626",
  },
  "sarah@drewross.org": {
    orgId: "drmf",
    role: "executive_director" as const,
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
      // Only allow whitelisted emails
      return !!(user.email && user.email in WHITELIST);
    },
    jwt({ token, user }) {
      if (user?.email && user.email in WHITELIST) {
        token.userConfig = WHITELIST[user.email as keyof typeof WHITELIST];
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
