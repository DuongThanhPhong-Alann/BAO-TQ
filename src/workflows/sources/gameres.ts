import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { GameResSource } from "../types";

async function sleep(ms: number): Promise<void> {
  if (!ms) return;
  await new Promise((r) => setTimeout(r, ms));
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
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

async function mapSequentialWithDelay<T, R>(
  items: T[],
  delayMs: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await fn(items[i], i));
    if (i < items.length - 1) await sleep(delayMs);
  }
  return results;
}

function cleanText(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t || null;
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

async function fetchHomeLinks(startUrl: string, userAgent: string): Promise<string[]> {
  const res = await fetch(startUrl, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const hot = $("article.hot-item h3.caption a")
    .map((_, el) => $(el).attr("href") || "")
    .get();
  const feed = $("a.feed-item-title-a")
    .map((_, el) => $(el).attr("href") || "")
    .get();

  const base = new URL(startUrl);
  const all = [...hot, ...feed]
    .map((s) => s.trim())
    .filter((s) => s.startsWith("/")) // giống n8n: bỏ link đầy đủ ngoài
    .map((href) => absolutize(base, href))
    .filter(Boolean) as string[];

  return uniq(all)
    .filter((u) => u.endsWith(".html")) // giống n8n Code1
    .map((u) => u.split("#")[0]);
}

async function fetchArticleDetails(
  url: string,
  userAgent: string
): Promise<{
  link: string;
  title: string | null;
  postingdate: string[]; // raw list (to follow n8n flow)
  description: string | null;
}> {
  const res = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const title = cleanText($("h1").first().text());
  const postingdate = $("span[style*=\"margin-right:10px\"]")
    .map((_, el) => cleanText($(el).text()) || "")
    .get()
    .filter(Boolean);
  const description = cleanText($('meta[name="description"]').attr("content"));

  return { link: url, title, postingdate, description };
}

export async function fetchGameRes(
  source: GameResSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<any[]> {
  const userAgent = source.userAgent || "Mozilla/5.0";
  const maxLinks = source.maxLinks ?? source.batchSize ?? 50;
  const detailConcurrency = source.detailConcurrency ?? 1;
  const detailDelayMs = source.detailDelayMs ?? 10_000;
  const detailRetries = source.detailRetries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;

  const links = (await fetchHomeLinks(source.startUrl, userAgent)).slice(0, maxLinks);
  logger.info({ links: links.length }, "GameRes: collected article links");
  opts.onProgress?.({ current: 0, total: links.length, text: "GameRes: fetching details..." });

  const fetchOne = async (href: string) => {
    try {
      return await withRetry(detailRetries, waitBetweenTriesMs, () =>
        fetchArticleDetails(href, userAgent)
      );
    } catch (err) {
      logger.warn({ err, href }, "GameRes: failed to fetch article details");
      return null;
    }
  };

  let completed = 0;

  const reportDone = () => {
    completed += 1;
    opts.onProgress?.({
      current: completed,
      total: links.length,
      text: `GameRes: fetching details ${completed}/${links.length}`
    });
  };

  let items: Array<any | null>;
  if (detailConcurrency === 1) {
    items = [];
    for (let i = 0; i < links.length; i++) {
      const href = links[i];
      items.push(await fetchOne(href));
      reportDone();
      if (detailDelayMs > 0 && i < links.length - 1) await sleep(detailDelayMs);
    }
  } else {
    items = await mapWithConcurrency(links, detailConcurrency, async (href) => {
      const it = await fetchOne(href);
      reportDone();
      return it;
    });
  }

  return items.filter(Boolean);
}
