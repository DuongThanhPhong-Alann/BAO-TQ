export function formatExtractedAtHCM(date = new Date()): string {
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false
  });
}
