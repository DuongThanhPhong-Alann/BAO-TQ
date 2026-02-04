import * as cheerio from "cheerio";
import { logger } from "../../logger";
import { DySource } from "../types";

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

function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return url;
  }
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

export type DyListItem = {
  link: string;
  title: string | null;
  time: string | null;
  image: string | null;
};

export async function fetchDy(source: DySource): Promise<DyListItem[]> {
  const userAgent = source.userAgent || "Mozilla/5.0";
  const res = await fetch(source.startUrl, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const base = new URL(source.startUrl);

  const items: DyListItem[] = [];

  const listItems = $("li.js-item.item").toArray();
  for (const li of listItems) {
    const imgAnchor = $(li).find('a.img[href]').first();
    const titleAnchor = $(li).find("a.title").first();
    const timeSpan = $(li).find("span.time").first();

    const href = cleanText(imgAnchor.attr("href") || undefined) || cleanText(titleAnchor.attr("href") || undefined);
    const linkAbs = href ? absolutize(base, href) : null;
    const link = linkAbs ? stripTracking(linkAbs) : null;
    if (!link) continue;

    const title = cleanText(titleAnchor.text()) || cleanText(titleAnchor.attr("title") || undefined);
    const time = cleanText(timeSpan.text());

    const imgEl = imgAnchor.find("img").first();
    const image =
      normalizeUrl(imgEl.attr("data-src")) ||
      normalizeUrl(imgEl.attr("src")) ||
      normalizeUrl(imgEl.attr("data-original")) ||
      null;

    items.push({ link, title, time, image });
  }

  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    if (seen.has(it.link)) return false;
    seen.add(it.link);
    return true;
  });

  const limited = typeof source.maxItems === "number" ? deduped.slice(0, source.maxItems) : deduped;
  logger.info({ items: limited.length }, "Dy: collected list items");
  return limited;
}

