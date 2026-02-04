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

export function transformGameRes(item: any): Record<string, unknown> {
  const title = item?.title ?? "";
  const description = item?.description ?? item?.Description ?? "";
  const postingDateList: string[] = Array.isArray(item?.postingdate) ? item.postingdate : [];

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const postingDate = postingDateList.find((entry) => dateRegex.test(entry)) ?? "";

  return {
    link: item?.link ?? "",
    title,
    description,
    "posting date": postingDate,
    extracted_at: formatNowHCM()
  };
}

