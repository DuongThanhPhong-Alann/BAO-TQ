export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let current: any = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
