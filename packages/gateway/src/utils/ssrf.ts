const PRIVATE_RANGES_V4 = [
  { prefix: "127.", mask: null },
  { prefix: "10.", mask: null },
  { prefix: "0.", mask: null },
  { prefix: "169.254.", mask: null },
];

function isInRange(ip: string, base: number[], maskBits: number): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;

  const ipNum = (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
  const baseNum = (base[0]! << 24) | (base[1]! << 16) | (base[2]! << 8) | base[3]!;
  const mask = ~((1 << (32 - maskBits)) - 1);

  return (ipNum & mask) === (baseNum & mask);
}

export function isPrivateOrReserved(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "0.0.0.0") return true;
  if (hostname === "::1" || hostname === "[::]") return true;

  // IPv6 private ranges
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower.startsWith("fe80")) return true; // fe80::/10

  // IPv4 checks
  for (const r of PRIVATE_RANGES_V4) {
    if (hostname.startsWith(r.prefix)) return true;
  }
  if (isInRange(hostname, [172, 16, 0, 0], 12)) return true;
  if (isInRange(hostname, [192, 168, 0, 0], 16)) return true;

  return false;
}

export class SSRFError extends Error {
  constructor(url: string) {
    super(`SSRF blocked: ${url} resolves to a private/reserved address`);
    this.name = "SSRFError";
  }
}

export function assertNotSSRF(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError(url);
  }
  if (isPrivateOrReserved(parsed.hostname)) {
    throw new SSRFError(url);
  }
}
