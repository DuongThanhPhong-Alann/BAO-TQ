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

function normalizeStatus(input: unknown): string {
  const items = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const cleaned = items.map(cleanText).filter(Boolean);
  return [...new Set(cleaned)].join(", ");
}

function normalizeLanguage(input: unknown): string {
  const items = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const cleaned = items.map(cleanText).filter(Boolean);
  return [...new Set(cleaned)].join(", ");
}

export function transformAfkLichgame(item: any): Record<string, unknown> {
  const imageUrl = normalizeImageUrl(item?.game_image ?? item?.image ?? "");
  const imageFormula = imageUrl ? `=IMAGE("${imageUrl}")` : "";

  return {
    link: item?.link ?? "",
    namegame: item?.namegame ?? "",
    game_image: imageFormula,
    release_date: item?.release_date ?? "",
    status: normalizeStatus(item?.status),
    note: item?.note ?? "",
    language: normalizeLanguage(item?.language),
    graphics: item?.graphics ?? "",
    vote: item?.vote ?? "",
    installation_file: item?.installation_file ?? "",
    fetch_time: formatNowHCM()
  };
}
