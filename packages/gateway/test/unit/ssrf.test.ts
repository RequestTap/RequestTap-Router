import { isPrivateOrReserved, assertNotSSRF, SSRFError } from "../../src/utils/ssrf.js";

describe("SSRF protection", () => {
  describe("isPrivateOrReserved", () => {
    test.each([
      "127.0.0.1",
      "127.0.0.2",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.1.100",
      "169.254.0.1",
      "0.0.0.0",
      "localhost",
      "::1",
    ])("blocks private/reserved: %s", (host) => {
      expect(isPrivateOrReserved(host)).toBe(true);
    });

    test.each([
      "8.8.8.8",
      "1.1.1.1",
      "203.0.113.50",
      "api.example.com",
    ])("allows public: %s", (host) => {
      expect(isPrivateOrReserved(host)).toBe(false);
    });
  });

  describe("assertNotSSRF", () => {
    test("throws SSRFError for private URL", () => {
      expect(() => assertNotSSRF("http://127.0.0.1:8080/api")).toThrow(SSRFError);
    });

    test("allows public URL", () => {
      expect(() => assertNotSSRF("https://api.example.com/v1")).not.toThrow();
    });

    test("throws for invalid URL", () => {
      expect(() => assertNotSSRF("not-a-url")).toThrow(SSRFError);
    });
  });
});
