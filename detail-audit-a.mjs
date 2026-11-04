import { chromium } from "playwright";
import fs from "fs";

const TARGETS = [
  "/compare/tokens",
  "/moonshot",
  "/gaps",
  "/news-feed",
  "/feeds",
  "/saham?tab=ideas",
  "/options",
  "/trending",
  "/charts",
  "/tokens/discover",
  "/fundamentals",
  "/financials",
  "/historical-financials",
  "/dcf",
  "/comps",
  "/insider",
  "/cycle-indicators",
  "/weather",
  "/alpha-engine",
  "/backtest",
  "/analytics",
  "/basis",
  "/arbitrage",
  "/flows"
];

const results = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();

for (const route of TARGETS) {
  const failed = [];
  const badResponses = [];
  const consoleErrors = [];
  page.removeAllListeners("requestfailed");
  page.removeAllListeners("response");
  page.removeAllListeners("console");
  page.on("requestfailed", req => {
    if (req.url().includes("/api/") || req.failure()?.errorText !== "net::ERR_ABORTED") {
      failed.push({ url: req.url(), error: req.failure()?.errorText });
    }
  });
  page.on("response", res => {
    if (res.url().includes("/api/") && res.status() >= 400) {
      badResponses.push({ url: res.url(), status: res.status() });
    }
  });
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    const res = await page.goto("http://127.0.0.1:4400" + route, { waitUntil: "networkidle", timeout: 25000 }).catch(() => null);
    const content = await page.evaluate(() => {
      const root = document.querySelector("main") || document.body;
      const text = root.innerText || "";
      const rows = document.querySelectorAll("tbody tr, [role=\"row\"]").length;
      const cards = document.querySelectorAll("[class*=\"card\"], [class*=\"panel\"], [class*=\"rounded\"]").length;
      const nanCount = (text.match(/\bNaN\b/g) || []).length;
      const undefinedCount = (text.match(/\bundefined\b/g) || []).length;
      const nullCount = (text.match(/\bnull\b/g) || []).length;
      const noDataMatch = text.match(/No data[^\n]*|No items[^\n]*|No signals[^\n]*|Not available[^\n]*|Unavailable[^\n]*/ig) || [];
      return {
        snippet: text.slice(0, 1200).replace(/\s+/g, " "),
        rows,
        cards,
        nanCount,
        undefinedCount,
        nullCount,
        noData: [...new Set(noDataMatch)].slice(0, 5),
        isBlank: text.length < 200
      };
    });
    results.push({ route, status: res ? res.status() : null, ...content, failed, badResponses, consoleErrors: consoleErrors.slice(0, 5) });
  } catch (err) {
    results.push({ route, error: String(err), failed, consoleErrors });
  }
}
fs.writeFileSync("/tmp/detail-audit-a.json", JSON.stringify(results, null, 2));
await browser.close();
