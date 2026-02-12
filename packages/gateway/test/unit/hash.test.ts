import { requestHash, canonicalString, hashBytes } from "../../src/hash.js";

describe("hash", () => {
  const baseParts = {
    method: "GET",
    path: "/api/v1/quote",
    bodyHash: "0x0000",
    price: "0.01",
    idempotencyKey: "key-1",
    timeWindow: "1000",
  };

  test("deterministic output", () => {
    const hash1 = requestHash(baseParts);
    const hash2 = requestHash(baseParts);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
  });

  test("different inputs produce different hashes", () => {
    const hash1 = requestHash(baseParts);
    const hash2 = requestHash({ ...baseParts, price: "0.02" });
    expect(hash1).not.toBe(hash2);
  });

  test("query param sorting produces consistent hash", () => {
    const hash1 = requestHash({ ...baseParts, query: { b: "2", a: "1" } });
    const hash2 = requestHash({ ...baseParts, query: { a: "1", b: "2" } });
    expect(hash1).toBe(hash2);
  });

  test("canonicalString includes all parts", () => {
    const canon = canonicalString(baseParts);
    expect(canon).toContain("GET");
    expect(canon).toContain("/api/v1/quote");
    expect(canon).toContain("0.01");
    expect(canon).toContain("key-1");
  });

  test("hashBytes hashes string data", () => {
    const h1 = hashBytes("hello");
    const h2 = hashBytes("hello");
    const h3 = hashBytes("world");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
