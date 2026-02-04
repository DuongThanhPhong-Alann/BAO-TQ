import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { AfkTopgameSource } from "../types";

type AfkTopgameItem = {
  rank: string;
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

function extractCapacityFromText(text: string): string {
  const cleaned = text.replace(/[()]/g, " ").trim();
  const match = cleaned.match(/Dung lượng\s*:\s*([^\n\r]+)/i);
  if (match) return match[1].trim();
  return "";
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
    parts.push(`${label}: ${href}`);
  });
  return parts.join("\n");
}

function extractCapacityFromDetail($: cheerio.CheerioAPI): string {
  const candidates = $("span.entry-date, .entry-date, li").toArray();
  for (const el of candidates) {
    const text = cleanText($(el).text());
    if (!/Dung lượng/i.test(text)) continue;
    const extracted = extractCapacityFromText(text);
    if (extracted) return extracted;
  }
  return "";
}

async function fetchDetail(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
}): Promise<
  Pick<AfkTopgameItem, "language" | "graphics" | "vote" | "installation_file" | "capacity">
> {
  const html = await fetchPageHtml(params);
  const $ = cheerio.load(html);

  const language = extractLanguages($);
  const graphics = extractGraphics($);
  const vote = extractVote($);
  const installation_file = extractInstallLinks($);
  const capacity = extractCapacityFromDetail($);

  return { language, graphics, vote, installation_file, capacity };
}

function parsePage(html: string, pageUrl: string): AfkTopgameItem[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const items: AfkTopgameItem[] = [];

  const top3 = $("#top3_ipa .m-rank-top3-item").toArray();
  top3.forEach((el, idx) => {
    const root = $(el);
    const className = cleanText(root.attr("class") || "");
    const match = className.match(/item(\d+)/);
    const rank = match?.[1] ?? String(idx + 1);

    let gameAnchor = root.find("a:has(img)").first();
    if (!gameAnchor.length) gameAnchor = root.find(".u-name a").first();
    if (!gameAnchor.length) gameAnchor = root.find('a[href*="/game/"]').first();

    const link = normalizeUrl(base, gameAnchor.attr("href") || "");
    if (!link) return;

    const img = gameAnchor.find("img").first();
    const namegame =
      cleanText(img.attr("alt")) || cleanText(root.find(".u-name a").first().text()) || "";
    const game_image =
      normalizeUrl(
        base,
        img.attr("data-src") ||
          img.attr("src") ||
          img.attr("data-original") ||
          img.attr("data-lazy") ||
          ""
      ) || "";

    const category = cleanText(root.find(".u-download-num a").first().text());

    items.push({
      rank,
      link,
      namegame,
      game_image,
      category,
      capacity: ""
    });
  });

  const listItems = $("#id_top_game article.post").toArray();
  for (const article of listItems) {
    const root = $(article);
    const rank = cleanText(root.find("a.rank").first().text());
    const imgAnchor = root.find("a.img-holder").first();
    const titleAnchor = root.find(".entry-title a").first();
    const link = normalizeUrl(base, imgAnchor.attr("href") || titleAnchor.attr("href") || "");
    if (!link) continue;

    const imgEl = imgAnchor.find("img").first();
    const namegame =
      cleanText(imgEl.attr("alt")) || cleanText(titleAnchor.text()) || "";

    const game_image =
      normalizeUrl(
        base,
        imgEl.attr("data-src") ||
          imgEl.attr("src") ||
          imgEl.attr("data-original") ||
          imgEl.attr("data-lazy") ||
          ""
      ) || "";

    const category = cleanText(root.find(".entry-meta .entry-cat a").first().text());
    const capacity = cleanText(root.find(".entry-meta .entry-date").first().text());

    items.push({
      rank,
      link,
      namegame,
      game_image,
      category,
      capacity
    });
  }

  return items;
}

export async function fetchAfkTopgame(
  source: AfkTopgameSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<AfkTopgameItem[]> {
  if (!source.listUrlTemplate.includes("{page}")) {
    throw new Error('AfkTopgame: listUrlTemplate must include "{page}"');
  }

  const userAgent = source.userAgent || "Mozilla/5.0";
  const pageFrom = source.pageFrom ?? 1;
  const pageTo = source.pageTo ?? pageFrom;
  const requestDelayMs = source.requestDelayMs ?? 0;
  const retries = source.retries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const maxItems = source.maxItems;
  const detailDelayMs = source.detailDelayMs ?? 0;
  const detailRetries = source.detailRetries ?? 0;

  const out: AfkTopgameItem[] = [];
  const seen = new Set<string>();
  const totalPages = Math.max(0, pageTo - pageFrom + 1);

  let pageIndex = 0;
  for (let page = pageFrom; page <= pageTo; page++) {
    pageIndex += 1;
    const url = source.listUrlTemplate.replace("{page}", String(page));
    opts.onProgress?.({
      current: pageIndex,
      total: totalPages,
      text: `AFK topgame: page ${page}/${pageTo}`
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
        if (!item.link) continue;
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        out.push(item);
        if (typeof maxItems === "number" && out.length >= maxItems) {
          logger.info({ items: out.length }, "AFK topgame: reached maxItems");
          return out;
        }
      }
    } catch (err) {
      logger.warn({ err, page, url }, "AFK topgame: failed to fetch page");
    }

    if (requestDelayMs > 0 && page < pageTo) await sleep(requestDelayMs);
  }

  for (let i = 0; i < out.length; i++) {
    const item = out[i];
    if (!item.link) continue;
    logger.info(
      { index: i + 1, total: out.length, url: item.link },
      "AFK topgame: fetching detail"
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
      if (detail.capacity) item.capacity = detail.capacity;
    } catch (err) {
      logger.warn({ err, url: item.link }, "AFK topgame: failed to fetch detail");
    }
    if (detailDelayMs > 0 && i < out.length - 1) await sleep(detailDelayMs);
  }

  logger.info({ items: out.length }, "AFK topgame: collected items");
  return out;
}
