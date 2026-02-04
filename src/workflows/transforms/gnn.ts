function uniqStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function cleanTitle(input: string): string {
  let title = input || "";
  title = title.replace(/\[?https?:\/\/[^\]\s]+]?/g, "");
  title = title.replace(/\S+\.php\?[^ \n]+/g, "");
  title = title.replace(/\s+/g, " ").trim();
  return title;
}

function extractTime(input: string): string {
  if (!input) return "";
  const match = input.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  return match ? match[0] : "";
}

function normalizeHashtags(input: unknown): string {
  const tags = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const cleaned = tags
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .filter((t) => !t.includes("http"))
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
  return uniqStrings(cleaned).join(", ");
}

function normalizeCategory(input: unknown): string {
  const categories = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [input]
      : [];
  return categories
    .map((c) => String(c ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeImageUrl(input: string): string {
  const img = (input || "").trim();
  if (!img) return "";
  if (img.startsWith("//")) return `https:${img}`;
  return img;
}

export function transformGnn(item: any): Record<string, unknown> {
  const title = cleanTitle(item?.title ?? "");
  const time = extractTime(item?.time ?? "");
  const category = normalizeCategory(item?.category);
  const hashtag = normalizeHashtags(item?.hashtag);

  const img = normalizeImageUrl(item?.image ?? "");
  const imgFormula = img ? `=IMAGE("${img}")` : "";

  return {
    link: item?.link ?? "",
    title,
    time,
    category,
    hashtag,
    imgFormula,
    source: item?.source ?? "gamer-GNN",
    extractedAt: new Date().toISOString()
  };
}

