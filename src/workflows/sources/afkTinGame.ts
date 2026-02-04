import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { AfkTinGameSource } from "../types";

type AfkTinGameItem = {
  link: string;
  title: string;
  posting_date: string;
  image: string;
  caption: string;
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

function parsePage(html: string, pageUrl: string): AfkTinGameItem[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const items: AfkTinGameItem[] = [];

  const container = $(".col-sm-8.col-xs-12.sssa.tingamecat").first();
  let listRoot = container.find(".postlist.news_post_game").first();
  if (!listRoot.length) listRoot = $(".postlist.news_post_game").first();
  if (!listRoot.length) listRoot = $(".news_post_game").first();

  const articles = listRoot.find("article.post").toArray();
  for (const article of articles) {
    const root = $(article);
    const imgAnchor = root.find("a.img-holder").first();
    const titleAnchor = root.find(".entry-title a").first();

    const link = normalizeUrl(base, imgAnchor.attr("href") || titleAnchor.attr("href") || "");
    if (!link) continue;

    const imgEl = imgAnchor.find("img").first();
    const image =
      normalizeUrl(
        base,
        imgEl.attr("data-src") ||
          imgEl.attr("src") ||
          imgEl.attr("data-original") ||
          imgEl.attr("data-lazy") ||
          ""
      ) || "";

    const title =
      cleanText(titleAnchor.text()) ||
      cleanText(imgEl.attr("alt")) ||
      cleanText(imgAnchor.attr("title")) ||
      "";

    const posting_date =
      cleanText(root.find(".entry-meta .entry-cat.find").first().text()) ||
      cleanText(root.find(".entry-meta .entry-date").first().text()) ||
      "";

    const caption =
      cleanText(root.find(".entry-content p").first().text()) ||
      cleanText(root.find(".entry-content").first().text()) ||
      "";

    items.push({ link, title, posting_date, image, caption });
  }

  return items;
}

export async function fetchAfkTinGame(
  source: AfkTinGameSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<AfkTinGameItem[]> {
  if (!source.listUrlTemplate.includes("{page}")) {
    throw new Error('AfkTinGame: listUrlTemplate must include "{page}"');
  }

  const userAgent = source.userAgent || "Mozilla/5.0";
  const pageFrom = source.pageFrom ?? 1;
  const pageTo = source.pageTo ?? pageFrom;
  const requestDelayMs = source.requestDelayMs ?? 0;
  const retries = source.retries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const maxItems = source.maxItems;

  const out: AfkTinGameItem[] = [];
  const seen = new Set<string>();
  const totalPages = Math.max(0, pageTo - pageFrom + 1);

  let pageIndex = 0;
  for (let page = pageFrom; page <= pageTo; page++) {
    pageIndex += 1;
    const url = source.listUrlTemplate.replace("{page}", String(page));
    opts.onProgress?.({
      current: pageIndex,
      total: totalPages,
      text: `AFK tin-game: page ${page}/${pageTo}`
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
          logger.info({ items: out.length }, "AFK tin-game: reached maxItems");
          return out;
        }
      }
    } catch (err) {
      logger.warn({ err, page, url }, "AFK tin-game: failed to fetch page");
    }

    if (requestDelayMs > 0 && page < pageTo) await sleep(requestDelayMs);
  }

  logger.info({ items: out.length }, "AFK tin-game: collected items");
  return out;
}
