import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const providers: import("next-auth/providers/index").Provider[] = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      const user = await prisma.user.findUnique({
        where: { email: credentials.email },
      });
      if (!user) return null;
      if (!user.passwordHash) return null;
      const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
      if (!isValid) return null;
      return { id: user.id, email: user.email, name: user.email };
    },
  }),
];

// Google OAuth is optional and env-gated.
if (hasGoogle) {
  const { default: GoogleProvider } = await import("next-auth/providers/google");
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user, account }) {
      // Google OAuth: persist the OAuth identity as a NEXUS User so the app's
      // own session (nexus-session cookie) can be minted for the middleware.
      //
      // NEXT STEP (external dep): `@auth/prisma-adapter` (Auth.js v5) is NOT
      // installed and `@next-auth/prisma-adapter` (next-auth v4) is NOT
      // installed either. Once one is added, replace this manual upsert with
      // `adapter: PrismaAdapter(prisma)` in authOptions and this signIn block
      // can be dropped. Until then this keeps Google sign-up creating a DB User.
      if (account?.provider === "google" && user.email) {
        try {
          await prisma.user.upsert({
            where: { email: user.email },
            update: {},
            create: {
              email: user.email,
              role: "free",
              plan: "free",
              emailVerified: new Date(),
            },
          });
        } catch (err) {
          console.error("[auth] Google signIn upsert failed:", err);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        // First login — attach the DB user identity so the session token
        // carries the app's own fields (id/role/plan). For OAuth the incoming
        // `user.id` is provider-scoped, so resolve against the DB by email.
        token.id = user.id;
        if (user.email) {
          const dbUser = await prisma.user
            .findUnique({
              where: { email: user.email },
              select: { id: true, role: true, plan: true },
            })
            .catch(() => null);
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role;
            token.plan = dbUser.plan;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = token.id;
        (session.user as Record<string, unknown>).role = token.role;
        (session.user as Record<string, unknown>).plan = token.plan;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Google OAuth only issues the next-auth session cookie, which the app
      // middleware does not read (it reads `nexus-session`). Route site-internal
      // post-auth redirects through the nexus-session bridge so the app's own
      // cookie is minted before continuing to callbackUrl. External provider
      // redirects (Google consent — never routed here) pass through untouched.
      if (url.startsWith(baseUrl) || url.startsWith("/")) {
        const dest = url.startsWith("/") ? `${baseUrl}${url}` : url;
        return `${baseUrl}/api/auth/nexus-session?callbackUrl=${encodeURIComponent(dest)}`;
      }
      return url;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const googleOAuthEnabled = hasGoogle;