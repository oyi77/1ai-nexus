import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary"
import { CsrfProvider } from "@/components/CsrfProvider"
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-head",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#080b0f",
}

export const metadata: Metadata = {
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${inter.variable} ${ibmPlexMono.variable} ${spaceGrotesk.variable} dark h-full antialiased`}
    >
      <head>
        <link rel="icon" href="/icon-512.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-full flex flex-col bg-bg-base text-text-primary font-sans">
        <CsrfProvider>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </CsrfProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
          }}
        />
      </body>
    </html>
  );
}
