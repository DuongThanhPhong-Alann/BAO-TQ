import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { GnnSource } from "../types";

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

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function absolutize(baseUrl: string, href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith("javascript:")) return null;
  if (h.startsWith("//")) return `https:${h}`;
  try {
    return new URL(h, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchSectionLinks(params: {
  startUrl: string;
  userAgent: string;
  maxLinks?: number;
}): Promise<string[]> {
  const res = await fetch(params.startUrl, { headers: { "user-agent": params.userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const links = $('a[href*="gnn.gamer.com.tw/detail.php?sn="]')
    .map((_, el) => $(el).attr("href") || "")
    .get()
    .map((h) => absolutize(params.startUrl, h))
    .filter(Boolean) as string[];

  const unique = uniq(links).map((u) => u.split("#")[0]);
  return typeof params.maxLinks === "number" ? unique.slice(0, params.maxLinks) : unique;
}

async function fetchDetail(params: {
  url: string;
  userAgent: string;
  retries: number;
  waitBetweenTriesMs: number;
}): Promise<{
  link: string;
  title: string;
  time: string;
  category: string[];
  hashtag: string[];
  image: string;
}> {
  const res = await withRetry(params.retries, params.waitBetweenTriesMs, async () => {
    const r = await fetch(params.url, { headers: { "user-agent": params.userAgent } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    return r;
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  const time = $("span.GN-lbox3C").first().text().trim();
  const category = $("ul.platform-tag li a")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const hashtag = $("div.GN-lbox3B a")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const imgEl = $('img[name="gnnPIC"]').first();
  let image =
    (imgEl.attr("data-src") ||
      imgEl.attr("src") ||
      imgEl.attr("data-original") ||
      imgEl.attr("data-lazy") ||
      "").trim();

  if (!image) {
    const srcset = (imgEl.attr("srcset") || "").trim();
    if (srcset) image = srcset.split(",")[0]?.trim().split(" ")[0]?.trim() || "";
  }

  if (!image) {
    image = ($('meta[property="og:image"]').attr("content") || "").trim();
  }

  return { link: params.url, title, time, category, hashtag, image };
}

export async function fetchGnn(
  source: GnnSource,
  opts: { onProgress?: (p: { current: number; total: number; text?: string }) => void } = {}
): Promise<any[]> {
  const userAgent = source.userAgent || "Mozilla/5.0";
  const maxLinksPerSection = source.maxLinksPerSection ?? 50;
  const maxItems = source.maxItems;
  const detailDelayMs = source.detailDelayMs ?? 1000;
  const detailRetries = source.detailRetries ?? 0;
  const waitBetweenTriesMs = source.waitBetweenTriesMs ?? 5000;

  const sections = source.sections || [];
  if (sections.length === 0) return [];

  const seenLinks = new Set<string>();
  const plan: Array<{ source: string; startUrl: string; links: string[] }> = [];

  for (const section of sections) {
    const sectionLinks = await fetchSectionLinks({
      startUrl: section.startUrl,
      userAgent,
      maxLinks: maxLinksPerSection
    });

    const newLinks = sectionLinks.filter((l) => {
      if (seenLinks.has(l)) return false;
      seenLinks.add(l);
      return true;
    });

    if (newLinks.length > 0) {
      plan.push({ source: section.source, startUrl: section.startUrl, links: newLinks });
    }

    logger.info(
      { section: section.source, startUrl: section.startUrl, links: newLinks.length },
      "GNN: collected links"
    );
  }

  const totalPlanned = plan.reduce((acc, s) => acc + s.links.length, 0);
  const total = typeof maxItems === "number" ? Math.min(maxItems, totalPlanned) : totalPlanned;
  opts.onProgress?.({ current: 0, total, text: "GNN: fetching details..." });

  const out: any[] = [];
  let completed = 0;

  for (const section of plan) {
    for (let i = 0; i < section.links.length; i++) {
      const url = section.links[i];
      try {
        const detail = await fetchDetail({
          url,
          userAgent,
          retries: detailRetries,
          waitBetweenTriesMs
        });
        out.push({ ...detail, source: section.source });
      } catch (err) {
        logger.warn({ err, url, section: section.source }, "GNN: failed to fetch detail");
      } finally {
        completed += 1;
        opts.onProgress?.({
          current: Math.min(completed, total),
          total,
          text: `GNN: fetching details ${Math.min(completed, total)}/${total}`
        });
      }

      if (typeof maxItems === "number" && out.length >= maxItems) return out;
      if (detailDelayMs > 0 && i < section.links.length - 1) await sleep(detailDelayMs);
    }
  }

  return out;
}
