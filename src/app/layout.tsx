import type { Metadata, Viewport } from "next";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary"
import { CsrfProvider } from "@/components/CsrfProvider"
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/jwt";
import { prisma } from "@/lib/db";
import { UserProvider, type CurrentUser } from "@/lib/user-context";
import { computeTier } from "@/lib/gamification-tier";
import "./globals.css";
import { PageviewBeacon } from '@/components/primitives/PageviewBeacon'


export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // WCAG 1.4.4 Resize Text: maximumScale:1 disables pinch-zoom. Allow zoom.
  maximumScale: 5,
  themeColor: "#080b0f",
}
export const metadata: Metadata = {
  metadataBase: new URL('https://tracker.aitradepulse.com'),
  title: "◆ NEXUS — Market Intelligence Terminal",
  description:
    "IDX bandarmology, fundamentals, 14 global markets, on-chain intel and AI signals — 38,902 instruments across 20 exchanges, served from memory in milliseconds. Free.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NEXUS",
  },
  openGraph: {
    title: "◆ NEXUS — Market Intelligence, Bloomberg-grade. Free.",
    description:
      "38,902 instruments · 20 exchanges · 15 markets · 58+ data modules. IDX bandarmology, fundamentals, on-chain and AI signals in one terminal.",
    url: "https://tracker.aitradepulse.com",
    siteName: "NEXUS",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "NEXUS — Market Intelligence Terminal" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "◆ NEXUS — Market Intelligence, Bloomberg-grade. Free.",
    description: "38,902 instruments · 20 exchanges · 15 markets. Free forever.",
    images: ["/og.png"],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let userData: CurrentUser | null = null;
  const token = (await cookies()).get("nexus-session")?.value;
  if (token) {
    const session = await verifyToken(token);
    if (session?.userId) {
      const u = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { xp: true, level: true, plan: true },
      });
      if (u) {
        userData = {
          xp: u.xp,
          level: u.level,
          plan: u.plan ? String(u.plan) : null,
          tier: computeTier(u.xp).tier,
        };
      }
    }
  }
  return (
    <html lang="en" className="dark h-full antialiased">
      <head>
        <link rel="icon" href="/icon-512.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-full flex flex-col bg-bg-base text-text-primary font-sans">
        <CsrfProvider>
          <ErrorBoundary>
            <UserProvider user={userData}>{children}</UserProvider>
          </ErrorBoundary>
        </CsrfProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
          }}
        />
        <PageviewBeacon />
      </body>
    </html>
  );
}
