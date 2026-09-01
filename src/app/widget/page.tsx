import { Metadata } from "next";
import Script from "next/script";
import { Panel } from "@/components/shell/Panel";
import { ExternalLink } from "lucide-react";
import { EmbedCodeBox } from "./embed-code";

export const metadata: Metadata = {
  title: "NEXUS Intelligence Widget — Embed",
  description:
    "Drop the NEXUS Intelligence widget into any site with one line. Shows live conviction signals and links back to tracker.aitradepulse.com.",
  openGraph: {
    title: "NEXUS Intelligence Widget",
    description: "Live conviction signals embed for any site.",
    url: "https://tracker.aitradepulse.com/widget",
  },
};

export default function WidgetPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-text-primary font-sans">
          NEXUS Intelligence Widget
        </h1>
        <p className="text-sm text-text-secondary">
          Drop this anywhere — 1ai-ads, 1ai-social, any site. The widget shows
          live conviction signals and links back to NEXUS.
        </p>
      </header>

      {/* Live preview */}
      <Panel title="Live preview" subtitle="as rendered on an external site">
        <div className="p-4 flex items-center justify-center">
          <div id="nexus-widget" className="w-full max-w-[360px]" />
        </div>
      </Panel>

      {/* Embed code */}
      <Panel title="Embed code" subtitle="paste into any page">
        <EmbedCodeBox />
      </Panel>

      {/* Usage notes */}
      <Panel title="Configuration">
        <ul className="list-disc list-inside space-y-1 text-sm text-text-secondary px-4 py-3">
          <li>
            <code className="text-text-primary">data-target</code> — CSS
            selector for the container (default <code className="text-text-primary">#nexus-widget</code>)
          </li>
          <li>
            <code className="text-text-primary">data-theme</code> —{" "}
            <code className="text-text-primary">dark</code> or{" "}
            <code className="text-text-primary">light</code> (default{" "}
            <code className="text-text-primary">dark</code>)
          </li>
          <li>
            If the target element is missing, the widget inserts itself next to
            the <code className="text-text-primary">&lt;script&gt;</code> tag.
          </li>
          <li>Powered-by backlink goes to{" "}
            <a
              href="https://tracker.aitradepulse.com"
              target="_blank"
              rel="noopener"
              className="text-teal-vivid hover:underline inline-flex items-center gap-1"
            >
              tracker.aitradepulse.com <ExternalLink size={12} />
            </a>
          </li>
        </ul>
      </Panel>

      <Script
        src="/nexus-widget.js"
        data-target="#nexus-widget"
        data-theme="dark"
        strategy="afterInteractive"
      />
    </div>
  );
}

