import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary"
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
  title: "◈ NEXUS — Intelligence Terminal",
  description: "AI-powered intelligence terminal for news, markets, macro, and alternative data. 58+ data modules, zero API keys.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NEXUS",
  },
  openGraph: {
    title: "◈ NEXUS",
    description: "AI-powered intelligence scanning terminal",
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
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
          }}
        />
      </body>
    </html>
  );
}
