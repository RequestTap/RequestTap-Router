import { readFileSync } from "fs";
import type { RouteRule, ProviderConfig } from "./routing.js";
import { logger } from "./utils/logger.js";

/**
 * JSON schema for routes configuration file.
 *
 * Example routes.json:
 * {
 *   "routes": [
 *     {
 *       "method": "GET",
 *       "path": "/api/v1/quote",
 *       "tool_id": "quote",
 *       "price_usdc": "0.01",
 *       "provider": {
 *         "provider_id": "acme-data",
 *         "backend_url": "https://api.acme.com",
 *         "auth": { "header": "Authorization", "value": "Bearer sk-..." }
 *       }
 *     }
 *   ]
 * }
 */
interface RoutesFileSchema {
  routes: RouteEntrySchema[];
}

interface RouteEntrySchema {
  method: string;
  path: string;
  tool_id: string;
  price_usdc: string;
  group?: string;
  description?: string;
  provider: {
    provider_id: string;
    backend_url: string;
    auth?: {
      header: string;
      value: string;
    };
  };
}

function validateRoute(entry: unknown, index: number): RouteEntrySchema {
  const e = entry as Record<string, unknown>;
  const prefix = `routes[${index}]`;

  if (!e || typeof e !== "object") {
    throw new Error(`${prefix}: must be an object`);
  }
  if (typeof e.method !== "string" || !e.method) {
    throw new Error(`${prefix}.method: must be a non-empty string`);
  }
  if (typeof e.path !== "string" || !e.path.startsWith("/")) {
    throw new Error(`${prefix}.path: must be a string starting with "/"`);
  }
  if (typeof e.tool_id !== "string" || !e.tool_id) {
    throw new Error(`${prefix}.tool_id: must be a non-empty string`);
  }
  if (typeof e.price_usdc !== "string") {
    throw new Error(`${prefix}.price_usdc: must be a string (decimal)`);
  }
  if (isNaN(parseFloat(e.price_usdc as string))) {
    throw new Error(`${prefix}.price_usdc: must be a valid decimal number`);
  }

  const provider = e.provider as Record<string, unknown>;
  if (!provider || typeof provider !== "object") {
    throw new Error(`${prefix}.provider: must be an object`);
  }
  if (typeof provider.provider_id !== "string" || !provider.provider_id) {
    throw new Error(`${prefix}.provider.provider_id: must be a non-empty string`);
  }
  if (typeof provider.backend_url !== "string" || !provider.backend_url) {
    throw new Error(`${prefix}.provider.backend_url: must be a non-empty string`);
  }
  if (provider.auth !== undefined) {
    const auth = provider.auth as Record<string, unknown>;
    if (!auth || typeof auth !== "object") {
      throw new Error(`${prefix}.provider.auth: must be an object`);
    }
    if (typeof auth.header !== "string" || !auth.header) {
      throw new Error(`${prefix}.provider.auth.header: must be a non-empty string`);
    }
    if (typeof auth.value !== "string") {
      throw new Error(`${prefix}.provider.auth.value: must be a string`);
    }
  }

  return entry as RouteEntrySchema;
}

export function loadRoutesFromFile(filePath: string): RouteRule[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read routes file "${filePath}": ${err}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse routes file "${filePath}" as JSON: ${err}`);
  }

  const file = parsed as RoutesFileSchema;
  if (!file || typeof file !== "object" || !Array.isArray(file.routes)) {
    throw new Error(`Routes file must contain a "routes" array`);
  }

  const rules: RouteRule[] = file.routes.map((entry, i) => {
    const validated = validateRoute(entry, i);
    const provider: ProviderConfig = {
      provider_id: validated.provider.provider_id,
      backend_url: validated.provider.backend_url,
    };
    if (validated.provider.auth) {
      provider.auth = {
        header: validated.provider.auth.header,
        value: validated.provider.auth.value,
      };
    }
    const rule: RouteRule = {
      method: validated.method.toUpperCase(),
      path: validated.path,
      tool_id: validated.tool_id,
      price_usdc: validated.price_usdc,
      provider,
    };
    if (validated.group) rule.group = validated.group;
    if (validated.description) rule.description = validated.description;
    return rule;
  });

  logger.info(`Loaded ${rules.length} routes from ${filePath}`);
  return rules;
}
