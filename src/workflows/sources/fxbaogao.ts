import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { FxbaogaoArchiveSource } from "../types";

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

function looksLikeDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text.trim());
}

function findItemRoot($: cheerio.CheerioAPI, a: any) {
  let current = $(a).parent();
  for (let i = 0; i < 8; i++) {
    const dateCount = current
      .find("span")
      .map((_: number, el: any) => cleanText($(el).text()) || "")
      .get()
      .filter((t: string) => looksLikeDate(t)).length;
    const detailAnchors = current.find('a[href^="/detail/"]').length;
    if (dateCount > 0 && detailAnchors === 1) return current;
    const next = current.parent();
    if (!next || next.length === 0) break;
    current = next;
  }
  return $(a).parent();
}

function extractFirstDate($: cheerio.CheerioAPI, root: any): string | null {
  const date = root
    .find("span")
    .map((_: number, el: any) => cleanText($(el).text()) || "")
    .get()
    .find((t: string) => looksLikeDate(t));
  return date || null;
}

function extractImageUrl($: cheerio.CheerioAPI, root: any): string | null {
  let img = root.find("img").first();
  if (img.length === 0) img = root.parent().find("img").first();
  if (img.length === 0) img = root.prevAll("img").first();
  if (img.length === 0) return null;

  const fromDataSrc = normalizeUrl(img.attr("data-src"));
  if (fromDataSrc) return fromDataSrc;

  const fromSrc = normalizeUrl(img.attr("src"));
  if (fromSrc) return fromSrc;

  const srcset = (img.attr("data-srcset") || img.attr("srcset") || "").trim();
  if (srcset) {
    const first = srcset.split(",")[0]?.trim().split(" ")[0]?.trim();
    const normalized = normalizeUrl(first);
    if (normalized) return normalized;
  }

  return null;
}

function buildListUrl(template: string, page: number): string {
  if (!template.includes("{page}")) {
    throw new Error(`Fxbaogao: listUrlTemplate must include "{page}" (got: ${template})`);
  }
  return template.replace(/\{page\}/g, String(page));
}

export type FxbaogaoListItem = {
  link: string;
  title: string | null;
  posting_date: string | null;
  image: string | null;
  page: number;
};

async function fetchFxbaogaoListPage(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
  page: number;
}): Promise<FxbaogaoListItem[]> {
  const res = await withRetry(params.retries, params.waitBetweenTriesMs, async () => {
    const r = await fetch(params.url, { headers: { "user-agent": params.userAgent } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r;
  });

  const html = await res.text();
  const $ = cheerio.load(html);
  const base = new URL(params.url);

  const items: FxbaogaoListItem[] = [];
  const anchors = $('a[href^="/detail/"][href][title]').toArray();
  for (const a of anchors) {
    const href = cleanText($(a).attr("href") || undefined);
    if (!href) continue;
    const link = absolutize(base, href);
    if (!link) continue;

    const title = cleanText($(a).attr("title") || undefined) || cleanText($(a).text());
    const root = findItemRoot($, a);
    const posting_date = extractFirstDate($, root);
    if (!posting_date) continue; // filter out nav/footer / unrelated anchors

    const image = extractImageUrl($, root);
    items.push({ link, title, posting_date, image, page: params.page });
  }

  // de-dup within the page (in case of repeated markup)
  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.link)) return false;
    seen.add(it.link);
    return true;
  });
}

export async function fetchFxbaogaoArchive(
  source: FxbaogaoArchiveSource,
  opts: {
    onProgress?: (p: { current: number; total: number; text?: string }) => void;
    onPageItems?: (p: {
      page: number;
      totalPages: number;
      url: string;
      items: FxbaogaoListItem[];
    }) => Promise<void> | void;
    collectAll?: boolean;
  } = {}
): Promise<FxbaogaoListItem[]> {
  const pageFrom = source.pageFrom ?? 1;
  const pageTo = source.pageTo ?? pageFrom;
  const totalPages = pageTo - pageFrom + 1;
  if (totalPages <= 0) return [];

  const userAgent = source.userAgent || "Mozilla/5.0";
  const requestDelayMs = source.requestDelayMs ?? 1000;
  const retries = source.retries ?? 1;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;
  const maxItems = source.maxItems;

  const collected: FxbaogaoListItem[] = [];
  const seen = new Set<string>();

  let completedPages = 0;
  for (let page = pageFrom; page <= pageTo; page++) {
    const url = buildListUrl(source.listUrlTemplate, page);
    opts.onProgress?.({
      current: completedPages,
      total: totalPages,
      text: `Fxbaogao: fetching page ${page}/${pageTo}`
    });

    let pageItems: FxbaogaoListItem[] = [];
    try {
      pageItems = await fetchFxbaogaoListPage({
        url,
        userAgent,
        retries,
        waitBetweenTriesMs,
        page
      });
    } catch (err) {
      logger.warn({ err, url, page }, "Fxbaogao: failed to fetch list page");
      pageItems = [];
    }

    const uniquePageItems = pageItems.filter((it) => {
      if (seen.has(it.link)) return false;
      seen.add(it.link);
      return true;
    });

    if (opts.onPageItems) {
      await opts.onPageItems({ page, totalPages, url, items: uniquePageItems });
    }

    if (opts.collectAll !== false) {
      collected.push(...uniquePageItems);
    }

    completedPages += 1;
    opts.onProgress?.({
      current: completedPages,
      total: totalPages,
      text: `Fxbaogao: fetched page ${page}/${pageTo} (${uniquePageItems.length} items)`
    });

    if (typeof maxItems === "number" && collected.length >= maxItems) break;
    if (requestDelayMs > 0 && page < pageTo) await sleep(requestDelayMs);
  }

  return collected;
}
