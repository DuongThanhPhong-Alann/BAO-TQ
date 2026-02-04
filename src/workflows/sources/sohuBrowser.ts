import { chromium } from "playwright";
import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { SohuBrowserSource } from "../types";

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function sleep(ms: number): Promise<void> {
  if (!ms) return;
  await new Promise((r) => setTimeout(r, ms));
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

function normalizeUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
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

async function extractSohuArticleDetails(
  url: string,
  userAgent: string
): Promise<{
  href: string;
  title: string | null;
  time: string | null;
  description: string | null;
  image: string | null;
  location: string | null;
}> {
  const res = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  const canonical = normalizeUrl($('link[rel="canonical"]').attr("href")) || url;
  const title =
    cleanText($("h1").first().text()) ||
    cleanText($("div.topic-title-size").first().text()) ||
    cleanText($("h3.content-main--title").first().text()) ||
    cleanText($('meta[property="og:title"]').attr("content")) ||
    cleanText($("title").text());
  const time =
    cleanText($("span#news-time").first().text()) ||
    cleanText($('meta[property="og:release_date"]').attr("content")) ||
    cleanText($('meta[itemprop="datePublished"]').attr("content")) ||
    cleanText($('meta[itemprop="dateUpdate"]').attr("content"));
  const location = cleanText($("div.area > span:last-child").first().text());
  const description = cleanText($('meta[name="description"]').attr("content"));
  const image =
    normalizeUrl($('meta[property="og:image"]').attr("content")) ||
    normalizeUrl($("img[src]").first().attr("src"));

  return {
    href: canonical,
    title,
    time,
    description,
    image,
    location
  };
}

function isSohuArticleLink(href: string): boolean {
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith("sohu.com")) return false;
    return u.pathname.startsWith("/a/");
  } catch {
    return false;
  }
}

export async function fetchSohuBrowser(source: SohuBrowserSource): Promise<any[]> {
  const maxLinks = source.maxLinks ?? 60;
  const detailConcurrency = source.detailConcurrency ?? 6;
  const detailDelayMs = source.detailDelayMs ?? 0;
  const detailRetries = source.detailRetries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const linkAttribute = source.linkAttribute || "href";

  const startUserAgent =
    source.startUserAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const detailUserAgent =
    source.detailUserAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  const browser = await chromium.launch({
    headless: source.headless ?? true,
    args: process.platform === "linux" ? ["--no-sandbox"] : undefined
  });
  try {
    const context = await browser.newContext({
      userAgent: startUserAgent
    });

    const allLinks: string[] = [];
    for (const startUrl of source.startUrls) {
      const page = await context.newPage();
      try {
        await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(1500);

        const selector = source.linkSelector || "a[href]";
        const rawLinks = await page.$$eval(
          selector,
          (els, attr) =>
            els
              .map((el) => {
                const a = el as HTMLAnchorElement;
                if (attr === "href") return a.getAttribute("href") || "";
                return (el as HTMLElement).getAttribute(attr as string) || "";
              })
              .filter((href) => typeof href === "string" && href.length > 0),
          linkAttribute
        );

        const base = new URL(startUrl);
        const normalized = rawLinks
          .map((href) => {
            const h = href.trim();
            if (!h) return null;
            if (h.startsWith("javascript:")) return null;
            if (h.startsWith("//")) return `https:${h}`;
            if (h.startsWith("/")) return `${base.origin}${h}`;
            return h;
          })
          .filter(Boolean) as string[];

        allLinks.push(...normalized.filter(isSohuArticleLink));
      } finally {
        await page.close().catch(() => {});
      }
    }

    const articleLinks = uniq(allLinks).slice(0, maxLinks);
    logger.info({ links: articleLinks.length }, "Sohu browser: collected article links");

    const fetchOne = async (href: string) => {
      try {
        return await withRetry(detailRetries, waitBetweenTriesMs, () =>
          extractSohuArticleDetails(href, detailUserAgent)
        );
      } catch (err) {
        logger.warn({ err, href }, "Failed to fetch article details");
        return null;
      }
    };

    const items =
      detailConcurrency === 1 && detailDelayMs > 0
        ? await mapSequentialWithDelay(articleLinks, detailDelayMs, (href) => fetchOne(href))
        : await mapWithConcurrency(articleLinks, detailConcurrency, (href) => fetchOne(href));

    const ok = items.filter(Boolean) as Array<Awaited<ReturnType<typeof extractSohuArticleDetails>>>;
    const deduped = new Map<string, (typeof ok)[number]>();
    for (const it of ok) {
      const key = it.href;
      if (!key) continue;
      if (!deduped.has(key)) deduped.set(key, it);
    }
    return [...deduped.values()];
  } finally {
    await browser.close().catch(() => {});
  }
}
