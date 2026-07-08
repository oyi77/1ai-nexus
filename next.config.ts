import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ['prisma', '@prisma/client', 'ioredis', 'jsonwebtoken'],
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
        // HTML pages — must revalidate, never serve stale
        source: "/:path((?!_next/static|api|favicon|manifest|sw|icon|robots|sitemap).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
