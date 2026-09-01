import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { signToken, createSessionCookie } from "@/lib/jwt";

export const dynamic = "force-dynamic";

/**
 * OAuth → nexus-session bridge.
 *
 * NextAuth's Google OAuth flow only issues the next-auth session cookie, which
 * the app middleware does not read (it reads `nexus-session`). After a
 * successful OAuth the `redirect` callback in src/lib/auth.ts points here.
 * This route resolves the NextAuth session, upserts the DB user (free plan by
 * default), mints the app's own JWT and sets the `nexus-session` cookie before
 * continuing to the original callbackUrl.
 *
 * NOTE: deliberately NOT mounted at `/api/auth/session` — that path is owned by
 * the NextAuth catch-all (`api/auth/[...nextauth]`); a static route there would
 * shadow and break NextAuth's own session endpoint.
 *
 * GET /api/auth/nexus-session?callbackUrl=/dashboard
 */
export async function GET(request: NextRequest) {
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") || "/";

  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) {
    // No active NextAuth session (e.g. sign-out pass-through) — just continue.
    return NextResponse.redirect(new URL(callbackUrl, request.url));
  }

  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        role: "free",
        plan: "free",
        emailVerified: new Date(),
      },
    });

    const token = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    });
    const cookie = createSessionCookie(token);

    const res = NextResponse.redirect(new URL(callbackUrl, request.url));
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    console.error("[auth] nexus-session bridge failed:", err);
    // Fail open to the callback URL — the app still works via the NextAuth
    // session cookie; only app-middleware-scoped features degrade.
    return NextResponse.redirect(new URL(callbackUrl, request.url));
  }
}
