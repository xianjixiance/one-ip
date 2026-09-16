/** Canonical IP literals only; never accept hostnames or shortened IPv4 forms. */
export function normalizeIp(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const ip = value.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const parts = ip.split(".");
    if (
      parts.some(
        (part) =>
          Number(part) > 255 || (part.length > 1 && part.startsWith("0")),
      )
    )
      return;
    return parts.map(Number).join(".");
  }
  if (!ip.includes(":") || !/^[\da-f:.]+$/i.test(ip)) return;
  try {
    return new URL(`https://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return;
  }
}
