// Protect /org/* routes: redirect unauthenticated users to /login with callbackUrl.
// NextAuth reads pages.signIn from auth.ts (/login) and appends ?callbackUrl automatically.
// The login page already passes callbackUrl through to Google OAuth redirect.
export { auth as default } from "@/auth";

export const config = {
  matcher: ["/org/:path*"],
};
