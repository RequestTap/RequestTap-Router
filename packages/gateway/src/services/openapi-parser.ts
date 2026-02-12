import type { RouteRule } from "../routing.js";

interface OpenApiPath {
  [method: string]: {
    operationId?: string;
    summary?: string;
    description?: string;
    [key: string]: unknown;
  };
}

interface OpenApiSpec {
  paths?: Record<string, OpenApiPath>;
  [key: string]: unknown;
}

export interface ParseDefaults {
  providerId: string;
  backendUrl: string;
  priceUsdc: string;
  authHeader?: string;
  authValue?: string;
}

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "options"]);

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function openApiPathToExpress(path: string): string {
  // Convert {param} to :param
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

function generateToolId(method: string, path: string, operationId?: string): string {
  if (operationId) return slugify(operationId);
  return slugify(`${method}-${path.replace(/[/:{}]/g, "-")}`);
}

export function parseOpenApiToRoutes(spec: OpenApiSpec, defaults: ParseDefaults): RouteRule[] {
  const routes: RouteRule[] = [];

  if (!spec.paths || typeof spec.paths !== "object") {
    throw new Error("OpenAPI spec must contain a 'paths' object");
  }

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== "object") continue;

      let expressPath = openApiPathToExpress(path);

      // Prefix with /api/v1 if not already prefixed
      if (!expressPath.startsWith("/api/")) {
        expressPath = expressPath.startsWith("/")
          ? `/api/v1${expressPath}`
          : `/api/v1/${expressPath}`;
      }

      const toolId = generateToolId(method, path, operation.operationId);

      const rule: RouteRule = {
        method: method.toUpperCase(),
        path: expressPath,
        tool_id: toolId,
        price_usdc: defaults.priceUsdc,
        description: operation.summary || operation.description || "",
        provider: {
          provider_id: defaults.providerId,
          backend_url: defaults.backendUrl,
        },
      };

      if (defaults.authHeader && defaults.authValue) {
        rule.provider.auth = {
          header: defaults.authHeader,
          value: defaults.authValue,
        };
      }

      routes.push(rule);
    }
  }

  return routes;
}
