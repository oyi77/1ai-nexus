export const dynamic = "force-dynamic";

import { type NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/api/response";
import {
  CRYPTO_FEEDS,
  getFeedsByCategory,
  getFeedStats,
  type FeedCategory,
  type SourceCredibility,
} from "@/lib/rss-feeds";
import { cleanHtml } from "@/lib/modules/news/rss/engine";

// ─── RSS XML Parser (minimal, no deps) ──────────────────────

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  category: string;
  credibility: SourceCredibility;
}

function parseRssXml(xml: string, sourceName: string, category: string, credibility: SourceCredibility): RssItem[] {
  const items: RssItem[] = [];
  // Match <item> or <entry> blocks
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractLink(block);
    const description = extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content");
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated") || "";

    if (title && link) {
      items.push({
        title: cleanHtml(title),
        link,
        description: cleanHtml(description).slice(0, 300),
        pubDate,
        source: sourceName,
        category,
        credibility,
      });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  // Handle CDATA: <tag><![CDATA[content]]></tag>
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular: <tag>content</tag>
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = regex.exec(xml);
  return m ? m[1].trim() : "";
}

function extractLink(block: string): string {
  // <link>url</link> or <link href="url" />
  const linkTag = extractTag(block, "link");
  if (linkTag.startsWith("http")) return linkTag;
  const hrefMatch = /<link[^>]*href=["']([^"']+)["']/i.exec(block);
  if (hrefMatch) return hrefMatch[1];
  // Atom: <id> as fallback
  return extractTag(block, "id");
}

// ─── Feed Fetching with Concurrency ─────────────────────────

async function fetchFeed(feed: typeof CRYPTO_FEEDS[0], timeoutMs = 5000): Promise<RssItem[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "NexusTracker/1.0",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssXml(xml, feed.name, feed.category, feed.credibility).slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchAllFeeds(
  feeds: typeof CRYPTO_FEEDS,
  concurrency = 8,
  overallTimeoutMs = 15_000,
): Promise<RssItem[]> {
  const results: RssItem[] = [];
  const deadline = Date.now() + overallTimeoutMs;

  // Process in batches with overall deadline
  for (let i = 0; i < feeds.length; i += concurrency) {
    if (Date.now() >= deadline) break; // Hit overall deadline, return what we have
    const batch = feeds.slice(i, i + concurrency);
    const remaining = Math.max(1000, deadline - Date.now());
    const batchResults = await Promise.allSettled(
      batch.map((f) => fetchFeed(f, Math.min(5000, remaining)))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(...r.value);
    }
  }
  // Sort by date (newest first), items without dates go last
  results.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });
  return results;
}

// ─── GET Handler ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const category = searchParams.get("category") as FeedCategory | null;
    const credibility = searchParams.get("credibility") as SourceCredibility | null;
    const tier = searchParams.get("tier") ? Number(searchParams.get("tier")) : null;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 30)));
    const includeStats = searchParams.get("stats") === "true";

    // Filter feeds
    let feeds = CRYPTO_FEEDS;
    if (category) feeds = getFeedsByCategory(category);
    if (credibility) feeds = feeds.filter((f) => f.credibility === credibility);
    if (tier) feeds = feeds.filter((f) => f.tier === tier);

    // Fetch articles
    const articles = await fetchAllFeeds(feeds);

    const response: Record<string, unknown> = {
      articles: articles.slice(0, limit),
      total: articles.length,
      feedCount: feeds.length,
    };

    if (includeStats) {
      response.stats = getFeedStats();
    }

    const r = apiSuccess(response, {
      total: articles.length,
    });
    r.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    return r;
  } catch (error) {
    console.error("GET /api/v1/feeds error:", error);
    return apiError("Failed to fetch RSS feeds", 502);
  }
}
