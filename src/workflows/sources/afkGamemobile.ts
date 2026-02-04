import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { AfkGamemobileSource } from "../types";

type AfkGamemobileItem = {
  link: string;
  namegame: string;
  game_image: string;
  category: string;
  capacity: string;
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

function extractCategory(li: cheerio.Cheerio<cheerio.Element>): string {
  const linkText = cleanText(li.find("a").first().text());
  if (linkText) return linkText;
  const text = cleanText(li.text());
  return text.replace(/Thể loại\s*:/i, "").trim();
}

function extractCapacity(li: cheerio.Cheerio<cheerio.Element>): string {
  const text = cleanText(li.text());
  return text.replace(/Dung lượng\s*:/i, "").trim();
}

function parsePage(html: string, pageUrl: string): AfkGamemobileItem[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const items: AfkGamemobileItem[] = [];

  let cards = $(".list_post_item .item_post").toArray();
  if (cards.length === 0) cards = $(".item_post").toArray();

  for (const card of cards) {
    const root = $(card);
    let anchor = root.find("a:has(img)").first();
    if (!anchor.length) anchor = root.find("h2 a").first();
    if (!anchor.length) anchor = root.find("a[href]").first();

    const link = normalizeUrl(base, anchor.attr("href") || "");
    if (!link) continue;

    const img = anchor.find("img").first();
    const fallbackImg = root.find("img").first();
    const imgEl = img.length ? img : fallbackImg;

    const namegame =
      cleanText(imgEl.attr("alt")) || cleanText(root.find("h2 a").first().text()) || "";

    const game_image =
      normalizeUrl(
        base,
        imgEl.attr("data-src") ||
          imgEl.attr("src") ||
          imgEl.attr("data-original") ||
          imgEl.attr("data-lazy") ||
          ""
      ) || "";

    let category = "";
    let capacity = "";
    root.find("ul li").each((_, el) => {
      const li = $(el);
      const text = cleanText(li.text());
      if (!category && /Thể loại/i.test(text)) category = extractCategory(li);
      if (!capacity && /Dung lượng/i.test(text)) capacity = extractCapacity(li);
    });

    items.push({ link, namegame, game_image, category, capacity });
  }

  return items;
}

export async function fetchAfkGamemobile(
  source: AfkGamemobileSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<AfkGamemobileItem[]> {
  if (!source.listUrlTemplate.includes("{page}")) {
    throw new Error('AfkGamemobile: listUrlTemplate must include "{page}"');
  }

  const userAgent = source.userAgent || "Mozilla/5.0";
  const pageFrom = source.pageFrom ?? 1;
  const pageTo = source.pageTo ?? pageFrom;
  const requestDelayMs = source.requestDelayMs ?? 0;
  const retries = source.retries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const maxItems = source.maxItems;

  const out: AfkGamemobileItem[] = [];
  const seen = new Set<string>();
  const totalPages = Math.max(0, pageTo - pageFrom + 1);

  let pageIndex = 0;
  for (let page = pageFrom; page <= pageTo; page++) {
    pageIndex += 1;
    const url = source.listUrlTemplate.replace("{page}", String(page));
    opts.onProgress?.({
      current: pageIndex,
      total: totalPages,
      text: `AFK gamemobile: page ${page}/${pageTo}`
    });

    try {
      const html = await fetchPageHtml({
        url,
        userAgent,
        retries,
        waitBetweenTriesMs
      });
      const items = parsePage(html, url);
      for (const item of items) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        out.push(item);
        if (typeof maxItems === "number" && out.length >= maxItems) {
          logger.info({ items: out.length }, "AFK gamemobile: reached maxItems");
          return out;
        }
      }
    } catch (err) {
      logger.warn({ err, page, url }, "AFK gamemobile: failed to fetch page");
    }

    if (requestDelayMs > 0 && page < pageTo) await sleep(requestDelayMs);
  }

  logger.info({ items: out.length }, "AFK gamemobile: collected items");
  return out;
}
