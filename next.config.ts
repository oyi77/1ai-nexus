import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ['prisma', '@prisma/client', 'ioredis', 'jsonwebtoken', 'bcryptjs', 'stripe'],
  // Typechecking is enforced at build time — `npx tsc --noEmit` is clean across
  // the whole tsconfig include set, so a type error must fail the build rather
  // than ship silently.
  typescript: { ignoreBuildErrors: false },
  
  // Turbopack: treat native modules as external during build
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('jsonwebtoken', 'bcryptjs');
    }
    return config;
  },
  
  async headers() {
    return [
      {
        // Static assets — immutable, long cache
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // HTML pages — must revalidate, never serve stale + sale-grade
        // security headers. CSP is permissive by necessity (Next inline
        // scripts, TradingView/Recharts embeds, WS) but blocks objects,
        // framing, and mixed content. HSTS via Cloudflare edge.
        source: "/:path((?!_next/static|api|favicon|manifest|sw|icon|robots|sitemap).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss: ws:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
      {
        // API routes — no sniff, no framing, explicit no-store.
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
