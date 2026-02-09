import { formatExtractedAtHCM } from "../../lib/time";

function normalizeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (!u) return null;
  if (u.startsWith("//")) return `https:${u}`;
  return u;
}

export function transformSina(item: any): Record<string, unknown> {
  const imageUrl = normalizeUrl(item?.image);
  return {
    link: normalizeUrl(item?.link) ?? null,
    title: item?.title ?? null,
    time: item?.time ?? null,
    image: imageUrl ? `=IMAGE("${imageUrl}")` : null,
    extractedAt: formatExtractedAtHCM()
  };
}
