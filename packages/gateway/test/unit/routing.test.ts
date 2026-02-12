import { compileRoutes, matchRule, RouteNotFoundError } from "../../src/routing.js";
import type { RouteRule } from "../../src/routing.js";

const provider = {
  provider_id: "test-provider",
  backend_url: "https://api.example.com",
};

const rules: RouteRule[] = [
  { method: "GET", path: "/api/v1/quote", tool_id: "quote", provider, price_usdc: "0.01" },
  { method: "GET", path: "/api/v1/users/:id", tool_id: "get-user", provider, price_usdc: "0.02" },
  { method: "GET", path: "/api/v1/users/:id/profile", tool_id: "get-profile", provider, price_usdc: "0.03" },
  { method: "POST", path: "/api/v1/submit", tool_id: "submit", provider, price_usdc: "0.05" },
];

describe("routing", () => {
  const compiled = compileRoutes(rules);

  test("exact path match returns correct price", () => {
    const result = matchRule(compiled, "GET", "/api/v1/quote");
    expect(result.rule.tool_id).toBe("quote");
    expect(result.price).toBe("0.01");
  });

  test("parameterized path /users/:id matches /users/42", () => {
    const result = matchRule(compiled, "GET", "/api/v1/users/42");
    expect(result.rule.tool_id).toBe("get-user");
    expect(result.params.id).toBe("42");
  });

  test("longest path wins: /users/:id/profile beats /users/:id", () => {
    const result = matchRule(compiled, "GET", "/api/v1/users/42/profile");
    expect(result.rule.tool_id).toBe("get-profile");
    expect(result.price).toBe("0.03");
  });

  test("method mismatch throws RouteNotFoundError", () => {
    expect(() => matchRule(compiled, "DELETE", "/api/v1/quote")).toThrow(RouteNotFoundError);
  });

  test("SSRF: provider with http://127.0.0.1 rejected at compile time", () => {
    const ssrfRules: RouteRule[] = [
      {
        method: "GET",
        path: "/internal",
        tool_id: "internal",
        provider: { provider_id: "evil", backend_url: "http://127.0.0.1:8080" },
        price_usdc: "0",
      },
    ];
    expect(() => compileRoutes(ssrfRules)).toThrow(/SSRF/);
  });
});
