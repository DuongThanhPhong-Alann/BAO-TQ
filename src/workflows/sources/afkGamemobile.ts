import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { logger } from "../../logger";
import { AfkGamemobileSource } from "../types";

type AfkGamemobileItem = {
  link: string;
  namegame: string;
  game_image: string;
  category: string;
  capacity: string;
  language?: string[];
  graphics?: string;
  vote?: string;
  installation_file?: string;
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

function extractCategory(li: cheerio.Cheerio<AnyNode>): string {
  const linkText = cleanText(li.find("a").first().text());
  if (linkText) return linkText;
  const text = cleanText(li.text());
  return text.replace(/Thể loại\s*:/i, "").trim();
}

function extractCapacity(li: cheerio.Cheerio<AnyNode>): string {
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

function extractLabelValue(text: string, labelRegex: RegExp): string {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  return cleaned.replace(labelRegex, "").trim();
}

function extractLanguages($: cheerio.CheerioAPI): string[] {
  const langs: string[] = [];
  $("li").each((_, el) => {
    const li = $(el);
    const text = cleanText(li.text());
    if (!/Ngôn ngữ/i.test(text)) return;

    li.find("img").each((__, img) => {
      const src = cleanText($(img).attr("src"));
      const alt = cleanText($(img).attr("alt"));
      if (/eng-active/i.test(src) || /england|english/i.test(alt)) langs.push("English");
      if (/vn-active/i.test(src) || /vietnam/i.test(alt)) langs.push("Việt Nam");
    });
  });
  return [...new Set(langs)];
}

function extractGraphics($: cheerio.CheerioAPI): string {
  let graphics = "";
  $("li").each((_, el) => {
    const li = $(el);
    const text = cleanText(li.text());
    if (!text) return;
    if (/Đồ ho[ạa]/i.test(text)) {
      graphics = extractLabelValue(text, /^Đồ ho[ạa]\s*:\s*/i);
    }
  });
  return graphics;
}

function extractVote($: cheerio.CheerioAPI): string {
  const voteText = cleanText($(".kksr-legend").first().text());
  return voteText;
}

function extractInstallLinks($: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  $(".btn_link_tai a[href]").each((_, el) => {
    const a = $(el);
    const href = cleanText(a.attr("href"));
    if (!href) return;
    const img = a.find("img").first();
    const imgSrc = cleanText(img.attr("src"));
    let label = "Link";
    if (/android-icon/i.test(imgSrc)) label = "Android";
    else if (/ios-icon/i.test(imgSrc)) label = "IOS";
    else if (/apk-icon/i.test(imgSrc)) label = "APK";
    const key = `${label}|${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(`${label}: ${href}`);
  });
  return parts.join("\n");
}

async function fetchDetail(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
}): Promise<
  Pick<AfkGamemobileItem, "language" | "graphics" | "vote" | "installation_file">
> {
  const html = await fetchPageHtml(params);
  const $ = cheerio.load(html);

  const language = extractLanguages($);
  const graphics = extractGraphics($);
  const vote = extractVote($);
  const installation_file = extractInstallLinks($);

  return { language, graphics, vote, installation_file };
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
  const detailConcurrency = Math.max(1, source.detailConcurrency ?? 1);
  const detailDelayMs = source.detailDelayMs ?? 0;
  const detailRetries = source.detailRetries ?? 0;

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
        logger.info({ index: out.length, url: item.link }, "AFK gamemobile: collected item");
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

  let nextIndex = 0;
  async function runWorker(workerId: number): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= out.length) return;
      const item = out[i];
      if (!item?.link) continue;

      logger.info(
        { index: i + 1, total: out.length, url: item.link, worker: workerId },
        "AFK gamemobile: fetching detail"
      );
      try {
        const detail = await fetchDetail({
          url: item.link,
          userAgent,
          retries: detailRetries,
          waitBetweenTriesMs
        });
        item.language = detail.language;
        item.graphics = detail.graphics;
        item.vote = detail.vote;
        item.installation_file = detail.installation_file;
      } catch (err) {
        logger.warn({ err, url: item.link, worker: workerId }, "AFK gamemobile: failed to fetch detail");
      }

      if (detailDelayMs > 0) await sleep(detailDelayMs);
    }
  }

  const workers = Array.from({ length: detailConcurrency }, (_, idx) => runWorker(idx + 1));
  await Promise.all(workers);

  logger.info({ items: out.length }, "AFK gamemobile: collected items");
  return out;
}
