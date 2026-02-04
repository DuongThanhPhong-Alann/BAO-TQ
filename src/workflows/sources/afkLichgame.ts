import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { AfkLichgameSource } from "../types";

type AfkLichgameItem = {
  link: string;
  namegame: string;
  game_image: string;
  release_date: string;
  status: string[];
  note: string;
  language?: string[];
  graphics?: string;
  vote?: string;
  installation_file?: string;
};

function cleanText(input?: string | null): string {
  const t = (input ?? "").replace(/\s+/g, " ").trim();
  return t;
}

function uniqStrings(items: string[]): string[] {
  return [...new Set(items)];
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

function parsePage(html: string, pageUrl: string): AfkLichgameItem[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const items: AfkLichgameItem[] = [];

  const articles = $("#lichgame article.post").toArray();
  for (const article of articles) {
    const root = $(article);
    const imgAnchor = root.find("a.img-holder").first();
    const titleAnchor = root.find(".entry-title a").first();

    const href = imgAnchor.attr("href") || titleAnchor.attr("href") || "";
    const link = normalizeUrl(base, href);
    if (!link) continue;

    const namegame =
      cleanText(titleAnchor.text()) ||
      cleanText(imgAnchor.find("img").first().attr("alt")) ||
      "";

    const imgEl = imgAnchor.find("img").first();
    const game_image =
      normalizeUrl(
        base,
        imgEl.attr("data-src") ||
          imgEl.attr("src") ||
          imgEl.attr("data-original") ||
          imgEl.attr("data-lazy") ||
          ""
      ) || "";

    const release_date = cleanText(root.find(".entry-meta .entry-date").first().text());

    const meta = root.find(".entry-meta").first();
    const statusLabels: string[] = [];
    meta.find("span").each((_, el) => {
      const elNode = $(el);
      if (elNode.hasClass("entry-date")) return;
      const t = cleanText(elNode.text());
      if (t) statusLabels.push(t);
    });
    meta.find("a").each((_, el) => {
      const t = cleanText($(el).text());
      if (t) statusLabels.push(t);
    });

    const status = uniqStrings(statusLabels);
    const note = cleanText(root.find(".entry-content").first().text());

    items.push({ link, namegame, game_image, release_date, status, note });
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

async function fetchDetail(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
}): Promise<Pick<AfkLichgameItem, "language" | "graphics" | "vote" | "installation_file">> {
  const html = await fetchPageHtml(params);
  const $ = cheerio.load(html);

  const language = extractLanguages($);
  const graphics = extractGraphics($);
  const vote = extractVote($);
  const installation_file = extractInstallLinks($);

  return { language, graphics, vote, installation_file };
}

export async function fetchAfkLichgame(
  source: AfkLichgameSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<AfkLichgameItem[]> {
  if (!source.listUrlTemplate.includes("{page}")) {
    throw new Error('AfkLichgame: listUrlTemplate must include "{page}"');
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

  const out: AfkLichgameItem[] = [];
  const seen = new Set<string>();
  const totalPages = Math.max(0, pageTo - pageFrom + 1);

  let pageIndex = 0;
  for (let page = pageFrom; page <= pageTo; page++) {
    pageIndex += 1;
    const url = source.listUrlTemplate.replace("{page}", String(page));
    opts.onProgress?.({
      current: pageIndex,
      total: totalPages,
      text: `AFK lichgame: page ${page}/${pageTo}`
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
          logger.info({ items: out.length }, "AFK lichgame: reached maxItems");
          return out;
        }
      }
    } catch (err) {
      logger.warn({ err, page, url }, "AFK lichgame: failed to fetch page");
    }

    if (requestDelayMs > 0 && page < pageTo) await sleep(requestDelayMs);
  }

  for (let i = 0; i < out.length; i++) {
    const item = out[i];
    if (!item.link) continue;
    logger.info(
      { index: i + 1, total: out.length, url: item.link },
      "AFK lichgame: fetching detail"
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
      logger.warn({ err, url: item.link }, "AFK lichgame: failed to fetch detail");
    }
    if (detailDelayMs > 0 && i < out.length - 1) await sleep(detailDelayMs);
  }

  logger.info({ items: out.length }, "AFK lichgame: collected items");
  return out;
}
