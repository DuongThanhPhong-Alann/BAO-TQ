export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function httpJson<T>(
  url: string,
  opts: { method: HttpMethod; headers?: Record<string, string>; body?: unknown }
): Promise<T> {
  const res = await fetch(url, {
    method: opts.method,
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {})
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${text}`);
  }

  return (await res.json()) as T;
}
