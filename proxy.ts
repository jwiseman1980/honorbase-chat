import { auth } from "@/auth";
import { NextResponse } from "next/server";

// In Next.js 16, the file convention changed from middleware.ts → proxy.ts
// and the function must be named `proxy` (or a default export).
// next-auth's auth() wrapper is compatible with this pattern.

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow auth routes and the login page through unconditionally
  if (
    pathname.startsWith("/api/auth") ||
    pathname === "/login" ||
    pathname.startsWith("/icons") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Unauthenticated → send to login
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static assets
    "/((?!_next/static|_next/image|icon-|apple-icon).*)",
  ],
};
