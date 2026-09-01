"use client";

import { useState } from "react";

const EMBED_CODE =
  '<script src="https://tracker.aitradepulse.com/nexus-widget.js" data-target="#nexus-widget" data-theme="dark"><' +
  "/script>";

export function EmbedCodeBox() {
  const [copied, setCopied] = useState(false);

  const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.select();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(EMBED_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        readOnly
        rows={4}
        className="w-full resize-none rounded-md border border-border-dim bg-bg-raised px-3 py-2 text-xs font-mono text-text-primary outline-none focus:border-teal-vivid"
        defaultValue={EMBED_CODE}
        onFocus={handleFocus}
      />
      <button
        onClick={handleCopy}
        className="rounded-md bg-teal-vivid px-3 py-1.5 text-xs font-semibold text-bg-base hover:opacity-90 transition-opacity"
      >
        {copied ? "Copied!" : "Copy embed code"}
      </button>
    </div>
  );
}
