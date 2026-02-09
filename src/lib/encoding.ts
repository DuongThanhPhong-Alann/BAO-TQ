function normalizeCharset(input: string): string {
  const c = (input || "").trim().toLowerCase();
  if (!c) return "utf-8";
  if (c === "utf8") return "utf-8";
  if (c === "gbk" || c === "gb2312" || c === "gb_2312-80") return "gb18030";
  if (c === "gb18030") return "gb18030";
  return c;
}

function detectCharsetFromContentType(contentType: string | null): string | null {
  const ct = (contentType || "").toLowerCase();
  const m = ct.match(/charset\s*=\s*([a-z0-9._-]+)/i);
  if (!m) return null;
  return normalizeCharset(m[1] || "");
}

function detectCharsetFromMeta(htmlHeadAscii: string): string | null {
  const head = (htmlHeadAscii || "").toLowerCase();

  // <meta charset="gb2312">
  const m1 = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9._-]+)\s*["']?/i);
  if (m1?.[1]) return normalizeCharset(m1[1]);

  // <meta http-equiv="Content-Type" content="text/html; charset=gb2312">
  const m2 = head.match(/charset\s*=\s*([a-z0-9._-]+)/i);
  if (m2?.[1]) return normalizeCharset(m2[1]);

  return null;
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const cs = normalizeCharset(charset);
  try {
    // Node's TextDecoder supports many encodings (including gb18030) when built with full ICU.
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export async function readHtmlResponse(res: Response): Promise<string> {
  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);

  const fromHeader = detectCharsetFromContentType(res.headers.get("content-type"));
  if (fromHeader) return decodeBytes(bytes, fromHeader);

  // sniff meta charset in the first ~4KB (ASCII-safe)
  const headAscii = Buffer.from(bytes.slice(0, 4096)).toString("ascii");
  const fromMeta = detectCharsetFromMeta(headAscii);
  if (fromMeta) return decodeBytes(bytes, fromMeta);

  return decodeBytes(bytes, "utf-8");
}

