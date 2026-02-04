import { formatExtractedAtHCM } from "../../lib/time";

function normalizeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export function transformSohu(item: any): Record<string, unknown> {
  const link = normalizeUrl(item?.href);

  let image: unknown = item?.image;
  if (Array.isArray(image)) image = image[0];
  const imageUrl = normalizeUrl(image);

  return {
    link: link ?? null,
    title: item?.title ?? null,
    time: item?.time ?? null,
    location: item?.location ?? null,
    description: item?.description ?? null,
    image: imageUrl ? `=IMAGE("${imageUrl}")` : null,
    image_url: imageUrl ?? null,
    extracted_at: formatExtractedAtHCM()
  };
}
