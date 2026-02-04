import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { AnyNode } from "domhandler";
import { logger } from "../../logger";
import { GamekSource } from "../types";

type GamekItem = {
  link: string;
  title: string;
  posting_date: string;
  image: string;
};

function cleanText(input?: string | null): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(base: URL, href?: string | null): string | null {
  const h = (href ?? "").trim();
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

async function fetchPageHtml(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
}): Promise<string> {
  return await withRetry(params.retries, params.waitBetweenTriesMs, async () => {
    const res = await fetch(params.url, { headers: { "user-agent": params.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  });
}

async function fetchPageHtmlWithLoadMore(params: {
  url: string;
  userAgent: string;
  clicks: number;
  selector?: string;
  waitMs: number;
}): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === "linux" ? ["--no-sandbox"] : undefined
  });

  try {
    const context = await browser.newContext({ userAgent: params.userAgent });
    const page = await context.newPage();
    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    const waitMs = Math.max(200, params.waitMs);
    for (let i = 0; i < params.clicks; i++) {
      const locator = params.selector
        ? page.locator(params.selector).first()
        : page.getByText(/xem thêm/i).first();

      const count = await locator.count();
      if (!count) break;

      try {
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ timeout: 5000 });
      } catch {
        break;
      }

      await page.waitForTimeout(waitMs);
    }

    return await page.content();
  } finally {
    await browser.close().catch(() => {});
  }
}

function buildPageUrl(rawUrl: string, page: number): string {
  const u = new URL(rawUrl);
  let pathname = u.pathname || "/";

  // Strip existing page-{n} segment if present.
  pathname = pathname.replace(/\/page-\d+(?=\.(chn|htm)$)/i, "");

  let ext = "chn";
  const extMatch = pathname.match(/\.(chn|htm)$/i);
  if (extMatch) {
    ext = extMatch[1].toLowerCase();
    pathname = pathname.slice(0, -extMatch[0].length);
  }

  if (pathname.endsWith("/") && pathname !== "/") pathname = pathname.slice(0, -1);

  const pagePath = pathname ? `${pathname}/page-${page}.${ext}` : `/page-${page}.${ext}`;
  u.pathname = pagePath;
  u.search = "";
  u.hash = "";
  return u.toString();
}

function isHomeUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}

function extractPostingDateFromText(text: string): string {
  const cleaned = cleanText(text);
  const m = cleaned.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
  return m?.[0] ?? "";
}

function findItemRoot(
  $: cheerio.CheerioAPI,
  start: cheerio.Cheerio<AnyNode>
): cheerio.Cheerio<AnyNode> {
  // Prefer the smallest ancestor that contains exactly one titled image link
  // and at least one time block, to avoid picking dates from other items.
  let cur: cheerio.Cheerio<AnyNode> = start;
  let fallback: cheerio.Cheerio<AnyNode> | null = null;
  for (let i = 0; i < 10; i++) {
    const timeCount = cur.find("p.time").length;
    const anchorCount = cur.find("a[title][href]:has(img)").length;
    if (timeCount > 0 && anchorCount === 1) return cur;
    if (timeCount > 0 && !fallback) fallback = cur;
    const parent = cur.parent();
    if (!parent.length) break;
    cur = parent;
  }
  return fallback ?? start;
}

function parsePage(html: string, pageUrl: string): GamekItem[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const items: GamekItem[] = [];

  // Heuristic: content cards usually have an <a title="..."> wrapping an <img>.
  // We also require a .chn/.htm suffix to reduce noise.
  const anchors = $("a[title][href]:has(img)").toArray();
  for (const a of anchors) {
    const el = $(a);
    const href = cleanText(el.attr("href"));
    if (!href) continue;

    // Keep typical article URLs.
    if (!/(\.(chn|htm))($|\?)/i.test(href)) {
      continue;
    }

    const link = normalizeUrl(base, href);
    if (!link) continue;

    const title = cleanText(el.attr("title")) || cleanText(el.find("img").first().attr("alt"));
    if (!title) continue;

    const imgEl = el.find("img").first();
    const image =
      normalizeUrl(
        base,
        imgEl.attr("data-src") ||
          imgEl.attr("src") ||
          imgEl.attr("data-original") ||
          imgEl.attr("data-lazy") ||
          ""
      ) || "";

    const root = findItemRoot($, el);
    const timeText = cleanText(root.find("p.time").first().text());
    const posting_date = extractPostingDateFromText(timeText);

    items.push({ link, title, posting_date, image });
  }

  return items;
}

export async function fetchGamek(
  source: GamekSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<GamekItem[]> {
  const startUrls = source.startUrls;
  if (!Array.isArray(startUrls) || startUrls.length === 0) {
    throw new Error("Gamek: source.startUrls is required");
  }

  const pageFrom = source.pageFrom;
  const pageTo = source.pageTo ?? pageFrom;
  const loadMoreClicks =
    typeof source.loadMoreClicks === "number"
      ? Math.max(0, source.loadMoreClicks)
      : typeof pageFrom === "number"
        ? Math.max(0, (pageTo ?? pageFrom) - pageFrom + 1)
        : 0;
  const loadMoreSelector = source.loadMoreSelector;
  const loadMoreWaitMs = source.loadMoreWaitMs ?? 1200;

  const urls: string[] = [];
  const homeUrls = new Set<string>();
  for (const baseUrl of startUrls) {
    if (isHomeUrl(baseUrl)) {
      homeUrls.add(baseUrl);
      urls.push(baseUrl);
      continue;
    }

    if (typeof pageFrom === "number") {
      const from = pageFrom;
      const to = typeof pageTo === "number" ? pageTo : pageFrom;
      for (let p = from; p <= to; p++) {
        urls.push(buildPageUrl(baseUrl, p));
      }
    } else {
      urls.push(baseUrl);
    }
  }

  const uniqueUrls = [...new Set(urls)];

  const userAgent = source.userAgent || "Mozilla/5.0";
  const requestDelayMs = source.requestDelayMs ?? 0;
  const retries = source.retries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const maxItems = source.maxItems;

  const out: GamekItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    opts.onProgress?.({
      current: i + 1,
      total: uniqueUrls.length,
      text: `GameK: fetching ${i + 1}/${uniqueUrls.length}`
    });

    try {
      const html =
        homeUrls.has(url) && loadMoreClicks > 0
          ? await fetchPageHtmlWithLoadMore({
              url,
              userAgent,
              clicks: loadMoreClicks,
              selector: loadMoreSelector,
              waitMs: loadMoreWaitMs
            })
          : await fetchPageHtml({ url, userAgent, retries, waitBetweenTriesMs });
      const items = parsePage(html, url);
      for (const item of items) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        out.push(item);
        if (typeof maxItems === "number" && out.length >= maxItems) {
          logger.info({ items: out.length }, "Gamek: reached maxItems");
          return out;
        }
      }
    } catch (err) {
      logger.warn({ err, url }, "Gamek: failed to fetch url");
    }

    if (requestDelayMs > 0 && i < uniqueUrls.length - 1) await sleep(requestDelayMs);
  }

  logger.info({ items: out.length }, "Gamek: collected items");
  return out;
}
