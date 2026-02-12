import { assertNotSSRF } from "./utils/ssrf.js";

export interface ProviderConfig {
  provider_id: string;
  backend_url: string;
  auth?: {
    header: string;
    value: string;
  };
}

export interface RouteRule {
  method: string;
  path: string;
  tool_id: string;
  provider: ProviderConfig;
  price_usdc: string;
  group?: string;
  description?: string;
}

export interface CompiledRule {
  rule: RouteRule;
  regex: RegExp;
  segmentCount: number;
  literalCount: number;
  insertionOrder: number;
}

export interface MatchResult {
  rule: RouteRule;
  price: string;
  params: Record<string, string>;
}

export class RouteNotFoundError extends Error {
  constructor(method: string, path: string) {
    super(`No route found for ${method} ${path}`);
    this.name = "RouteNotFoundError";
  }
}

function pathToRegex(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

export function compileRoutes(rules: RouteRule[]): CompiledRule[] {
  return rules.map((rule, i) => {
    assertNotSSRF(rule.provider.backend_url);

    const segments = rule.path.split("/").filter(Boolean);
    const literalCount = segments.filter((s) => !s.startsWith(":")).length;
    const { regex } = pathToRegex(rule.path);

    return {
      rule,
      regex,
      segmentCount: segments.length,
      literalCount,
      insertionOrder: i,
    };
  }).sort((a, b) => {
    // More segments first, then more literals, then insertion order
    if (b.segmentCount !== a.segmentCount) return b.segmentCount - a.segmentCount;
    if (b.literalCount !== a.literalCount) return b.literalCount - a.literalCount;
    return a.insertionOrder - b.insertionOrder;
  });
}

export function matchRule(compiled: CompiledRule[], method: string, path: string): MatchResult {
  for (const entry of compiled) {
    if (entry.rule.method.toUpperCase() !== method.toUpperCase()) continue;

    const match = entry.regex.exec(path);
    if (match) {
      const { paramNames } = pathToRegex(entry.rule.path);
      const params: Record<string, string> = {};
      paramNames.forEach((name, idx) => {
        params[name] = match[idx + 1]!;
      });
      return { rule: entry.rule, price: entry.rule.price_usdc, params };
    }
  }

  throw new RouteNotFoundError(method, path);
}
