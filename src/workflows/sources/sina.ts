import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { SinaSource } from "../types";

async function sleep(ms: number): Promise<void> {
  if (!ms) return;
  await new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  retries: number,
  waitBetweenMs: number,
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(waitBetweenMs);
    }
  }
  throw lastErr;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = new Array(Math.max(1, concurrency)).fill(0).map(() => worker());
  await Promise.all(workers);
  return results;
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function cleanText(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t || null;
}

function normalizeUrl(url: string | undefined | null): string | null {
  const u = (url || "").trim();
  if (!u) return null;
  if (u.startsWith("//")) return `https:${u}`;
  return u;
}

function absolutize(base: URL, href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith("javascript:")) return null;
  if (h.startsWith("//")) return `https:${h}`;
  if (h.startsWith("/")) return `${base.origin}${h}`;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return url;
  }
}

function looksLikeArticle(url: string): boolean {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    return p.endsWith(".shtml") || p.endsWith(".html");
  } catch {
    return false;
  }
}

async function fetchHomepageLinks(params: {
  startUrl: string;
  userAgent: string;
  linkSelectors: string[];
}): Promise<string[]> {
  const res = await fetch(params.startUrl, { headers: { "user-agent": params.userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const base = new URL(params.startUrl);
  const raw: string[] = [];

  for (const sel of params.linkSelectors) {
    raw.push(
      ...$(sel)
        .find("a[href]")
        .map((_, el) => $(el).attr("href") || "")
        .get()
    );
  }

  return uniq(
    raw
      .map((h) => absolutize(base, h))
      .filter(Boolean)
      .map((u) => stripTracking(u as string))
      .filter(looksLikeArticle)
      .map((u) => u.split("#")[0])
  );
}

async function fetchSinaDetail(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
}): Promise<{
  link: string;
  title: string | null;
  time: string | null;
  image: string | null;
}> {
  const res = await withRetry(params.retries, params.waitBetweenTriesMs, async () => {
    const r = await fetch(params.url, { headers: { "user-agent": params.userAgent } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r;
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const canonical =
    normalizeUrl($('link[rel="canonical"]').attr("href")) ||
    normalizeUrl($('meta[property="og:url"]').attr("content")) ||
    params.url;

  const title =
    cleanText($("h1.main-title").first().text()) ||
    cleanText($("h1").first().text()) ||
    cleanText($('meta[property="og:title"]').attr("content")) ||
    cleanText($("title").text());

  const time =
    cleanText($("span.date").first().text()) ||
    cleanText($('meta[property="og:time"]').attr("content")) ||
    cleanText($('meta[property="og:published_time"]').attr("content")) ||
    cleanText($('meta[property="article:published_time"]').attr("content")) ||
    cleanText($('meta[name="weibo: article:create_at"]').attr("content"));

  let image =
    normalizeUrl($('meta[property="og:image"]').attr("content")) ||
    normalizeUrl($("img[src]").first().attr("src"));

  if (!image) {
    const imgEl = $("img[srcset]").first();
    const srcset = (imgEl.attr("srcset") || "").trim();
    if (srcset) image = srcset.split(",")[0]?.trim().split(" ")[0]?.trim() || null;
  }

  return {
    link: stripTracking(canonical),
    title,
    time,
    image: image ? stripTracking(image) : null
  };
}

export async function fetchSina(
  source: SinaSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<any[]> {
  const userAgent = source.userAgent || "Mozilla/5.0";
  const maxLinks = source.maxLinks ?? 50;
  const detailConcurrency = source.detailConcurrency ?? 1;
  const detailDelayMs = source.detailDelayMs ?? 1000;
  const detailRetries = source.detailRetries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const linkSelectors = source.linkSelectors ?? [
    "ul.list-a.slide-a.list-a-201406121603",
    "ul.bd.list-b",
    "ul.uni-blk-list02.list-a"
  ];

  const links = (await fetchHomepageLinks({ startUrl: source.startUrl, userAgent, linkSelectors }))
    .slice(0, maxLinks)
    .map((u) => u.split("#")[0]);

  logger.info({ links: links.length }, "Sina: collected article links");
  opts.onProgress?.({ current: 0, total: links.length, text: "Sina: fetching details..." });

  let completed = 0;
  const reportDone = () => {
    completed += 1;
    opts.onProgress?.({
      current: completed,
      total: links.length,
      text: `Sina: fetching details ${completed}/${links.length}`
    });
  };

  const fetchOne = async (url: string) => {
    try {
      return await fetchSinaDetail({
        url,
        userAgent,
        retries: detailRetries,
        waitBetweenTriesMs
      });
    } catch (err) {
      logger.warn({ err, url }, "Sina: failed to fetch detail");
      return null;
    } finally {
      reportDone();
    }
  };

  let items: Array<any | null>;
  if (detailConcurrency === 1) {
    items = [];
    for (let i = 0; i < links.length; i++) {
      items.push(await fetchOne(links[i]));
      if (detailDelayMs > 0 && i < links.length - 1) await sleep(detailDelayMs);
    }
  } else {
    items = await mapWithConcurrency(links, detailConcurrency, async (url) => fetchOne(url));
  }

  return items.filter(Boolean);
}

