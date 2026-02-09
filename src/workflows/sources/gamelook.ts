import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { logger } from "../../logger";
import { GamelookSource } from "../types";

type GamelookItem = {
  link: string;
  title: string | null;
  posting_date: string | null;
  description: string | null;
  image_url: string | null;
};

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

function cleanText(input?: string | null): string | null {
  const t = (input ?? "").replace(/\s+/g, " ").trim();
  return t || null;
}

function normalizeUrl(base: URL, href?: string | null): string | null {
  const h = (href ?? "").trim();
  if (!h) return null;
  if (h.startsWith("javascript:")) return null;
  if (h.startsWith("//")) return `https:${h}`;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(params: {
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

function parseListLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const raw = $("h2.item-title a")
    .map((_, el) => ($(el).attr("href") ?? "").trim())
    .get();

  return raw
    .map((href) => normalizeUrl(base, href))
    .filter(Boolean)
    .map((u) => (u as string).split("#")[0]);
}

function pickFirstText($: cheerio.CheerioAPI, selectors: string[]): string | null {
  for (const sel of selectors) {
    const txt = cleanText($(sel).first().text());
    if (txt) return txt;
  }
  return null;
}

function pickFirstAttr(
  $: cheerio.CheerioAPI,
  selectors: string[],
  attr: string
): string | null {
  for (const sel of selectors) {
    const val = cleanText($(sel).first().attr(attr) ?? null);
    if (val) return val;
  }
  return null;
}

function normalizeImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function extractPostingDate($: cheerio.CheerioAPI): string | null {
  const meta =
    cleanText($('meta[property="article:published_time"]').attr("content") ?? null) ||
    cleanText($('meta[name="pubdate"]').attr("content") ?? null) ||
    cleanText($('meta[name="publishdate"]').attr("content") ?? null) ||
    cleanText($("time").first().attr("datetime") ?? null);
  if (meta) return meta;

  const dateRe = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
  const candidates = $(
    [
      ".entry-meta span",
      ".post-meta span",
      "span.date",
      "span.time",
      "div.entry span",
      "article span",
      "span"
    ].join(",")
  )
    .map((_, el) => cleanText($(el).text()) ?? "")
    .get()
    .filter(Boolean);

  for (const text of candidates) {
    const m = text.match(dateRe);
    if (m) return m[0];
  }

  return null;
}

function extractRepresentativeImageUrl($: cheerio.CheerioAPI): string | null {
  const candidates: string[] = [];

  const addFrom = (el: AnyNode) => {
    const node = $(el);
    const url =
      cleanText(node.attr("data-original") ?? null) ||
      cleanText(node.attr("data-src") ?? null) ||
      cleanText(node.attr("src") ?? null);
    if (url) candidates.push(url);
  };

  // Prefer content images (lazy-loaded `data-original` like the sample)
  $(
    [
      "div.entry img[data-original]",
      "div.entry img.j-lazy",
      "div.entry img",
      ".entry-content img[data-original]",
      ".entry-content img.j-lazy",
      ".entry-content img",
      "article img[data-original]",
      "article img.j-lazy",
      "article img"
    ].join(",")
  )
    .toArray()
    .forEach(addFrom);

  // Fallback to any image on the page (still take the first valid one)
  if (candidates.length === 0) $("img").toArray().forEach(addFrom);

  const normalized = candidates
    .map((u) => normalizeImageUrl(u))
    .filter(Boolean)
    // Remove obvious non-content images (best-effort)
    .filter((u) => !String(u).toLowerCase().includes("logo"));

  return normalized[0] ?? null;
}

async function fetchArticleDetails(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
}): Promise<GamelookItem> {
  const html = await fetchHtml(params);
  const $ = cheerio.load(html);

  const title = cleanText($("h1").first().text());

  const description =
    cleanText($('meta[name="description"]').attr("content") ?? null) ||
    cleanText($('meta[property="og:description"]').attr("content") ?? null);

  const image_url =
    extractRepresentativeImageUrl($) ||
    normalizeImageUrl(cleanText($('meta[property="og:image"]').attr("content") ?? null));

  const posting_date =
    extractPostingDate($) ||
    pickFirstText($, [".entry-meta .date", ".entry-meta .time", ".post-meta .date"]);

  return {
    link: params.url,
    title,
    posting_date,
    description,
    image_url
  };
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

export async function fetchGamelook(
  source: GamelookSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<GamelookItem[]> {
  if (!source.listUrlTemplate.includes("{page}")) {
    throw new Error('Gamelook: listUrlTemplate must include "{page}"');
  }

  const userAgent = source.userAgent || "Mozilla/5.0";
  const pageFrom = source.pageFrom ?? 1;
  const pageTo = source.pageTo ?? pageFrom;
  const requestDelayMs = source.requestDelayMs ?? 0;
  const retries = source.retries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const maxItems = source.maxItems;
  const detailConcurrency = source.detailConcurrency ?? 1;
  const detailDelayMs = source.detailDelayMs ?? 10_000;
  const detailRetries = source.detailRetries ?? 0;

  const links: string[] = [];
  const seen = new Set<string>();
  const totalPages = Math.max(0, pageTo - pageFrom + 1);

  let pageIndex = 0;
  for (let page = pageFrom; page <= pageTo; page++) {
    pageIndex += 1;
    const url = source.listUrlTemplate.replace("{page}", String(page));
    opts.onProgress?.({ current: pageIndex, total: totalPages, text: `Gamelook: page ${page}` });

    try {
      const html = await fetchHtml({ url, userAgent, retries, waitBetweenTriesMs });
      const pageLinks = parseListLinks(html, url);
      for (const link of pageLinks) {
        if (seen.has(link)) continue;
        seen.add(link);
        links.push(link);
        if (typeof maxItems === "number" && links.length >= maxItems) break;
      }
    } catch (err) {
      logger.warn({ err, page, url }, "Gamelook: failed to fetch list page");
    }

    if (typeof maxItems === "number" && links.length >= maxItems) break;
    if (requestDelayMs > 0 && page < pageTo) await sleep(requestDelayMs);
  }

  const limitedLinks =
    typeof maxItems === "number" ? links.slice(0, Math.max(0, maxItems)) : links;

  logger.info({ links: limitedLinks.length }, "Gamelook: collected article links");
  opts.onProgress?.({
    current: 0,
    total: limitedLinks.length,
    text: "Gamelook: fetching details..."
  });

  let completed = 0;
  const reportDone = () => {
    completed += 1;
    opts.onProgress?.({
      current: completed,
      total: limitedLinks.length,
      text: `Gamelook: details ${completed}/${limitedLinks.length}`
    });
  };

  const fetchOne = async (url: string): Promise<GamelookItem | null> => {
    try {
      const item = await withRetry(detailRetries, waitBetweenTriesMs, () =>
        fetchArticleDetails({ url, userAgent, retries: 0, waitBetweenTriesMs })
      );
      return item;
    } catch (err) {
      logger.warn({ err, url }, "Gamelook: failed to fetch article details");
      return null;
    } finally {
      reportDone();
    }
  };

  let items: Array<GamelookItem | null>;
  if (detailConcurrency === 1) {
    items = [];
    for (let i = 0; i < limitedLinks.length; i++) {
      items.push(await fetchOne(limitedLinks[i]));
      if (detailDelayMs > 0 && i < limitedLinks.length - 1) await sleep(detailDelayMs);
    }
  } else {
    items = await mapWithConcurrency(limitedLinks, detailConcurrency, async (u) => await fetchOne(u));
  }

  return items.filter(Boolean) as GamelookItem[];
}
