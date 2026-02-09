function formatNowHCM(): string {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = dtf.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get(
    "second"
  )}`;
}

function cleanText(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImageUrl(input: unknown): string {
  const img = cleanText(input);
  if (!img) return "";
  if (img.startsWith("//")) return `https:${img}`;
  return img;
}

export function transformGamelook(item: any): Record<string, unknown> {
  const imageUrl = normalizeImageUrl(item?.image_url ?? item?.image ?? "");
  const imageFormula = imageUrl ? `=IMAGE("${imageUrl}")` : "";

  return {
    link: item?.link ?? "",
    title: item?.title ?? "",
    posting_date: item?.posting_date ?? item?.postingdate ?? "",
    description: item?.description ?? "",
    extracted_at: formatNowHCM(),
    image: imageFormula
  };
}

