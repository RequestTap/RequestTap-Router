import { keccak256, toHex } from "viem";

export function canonicalString(parts: {
  method: string;
  path: string;
  query?: Record<string, string>;
  bodyHash: string;
  price: string;
  idempotencyKey: string;
  timeWindow: string;
}): string {
  const sortedQuery = parts.query
    ? Object.keys(parts.query)
        .sort()
        .map((k) => `${k.toLowerCase()}=${encodeURIComponent(parts.query![k]!)}`)
        .join("&")
    : "";

  return [
    parts.method.toUpperCase(),
    parts.path,
    sortedQuery,
    parts.bodyHash,
    parts.price,
    parts.idempotencyKey,
    parts.timeWindow,
  ].join("|");
}

export function requestHash(parts: Parameters<typeof canonicalString>[0]): string {
  const canonical = canonicalString(parts);
  return keccak256(toHex(canonical));
}

export function hashBytes(data: Uint8Array | string): string {
  if (typeof data === "string") {
    return keccak256(toHex(data));
  }
  return keccak256(toHex(data));
}
