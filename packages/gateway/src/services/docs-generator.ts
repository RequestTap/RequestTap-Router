import type { RouteRule } from "../routing.js";
import type { RouteGroup } from "./config-store.js";

export interface DocsMetadata {
  title: string;
  description: string;
  baseUrl: string;
  payToAddress: string;
}

export function generateAgentApiDocs(
  routes: RouteRule[],
  groups: RouteGroup[],
  meta: DocsMetadata,
): object {
  // Build group lookup: toolId -> group
  const toolGroupMap = new Map<string, RouteGroup>();
  for (const group of groups) {
    for (const toolId of group.toolIds) {
      toolGroupMap.set(toolId, group);
    }
  }

  // Build tags from groups
  const tags: { name: string; description: string }[] = [];
  const seenTags = new Set<string>();

  for (const group of groups) {
    if (!seenTags.has(group.name)) {
      tags.push({ name: group.name, description: group.description });
      seenTags.add(group.name);
    }
  }

  // Check if any routes are ungrouped
  const hasUngrouped = routes.some((r) => !toolGroupMap.has(r.tool_id));
  if (hasUngrouped) {
    tags.push({ name: "Ungrouped", description: "Routes not assigned to a group" });
  }

  // Build paths
  const paths: Record<string, Record<string, object>> = {};

  for (const route of routes) {
    const group = toolGroupMap.get(route.tool_id);
    const tagName = group ? group.name : "Ungrouped";
    const price = group?.priceUsdc || route.price_usdc;

    const pathKey = route.path;
    if (!paths[pathKey]) paths[pathKey] = {};

    paths[pathKey][route.method.toLowerCase()] = {
      tags: [tagName],
      summary: route.description || `${route.method} ${route.path}`,
      operationId: route.tool_id,
      "x-requesttap-tool-id": route.tool_id,
      "x-requesttap-price": price,
      parameters: extractPathParams(route.path),
      responses: {
        "200": { description: "Successful response" },
        "402": { description: "Payment Required — x402 payment header missing or invalid" },
        "404": { description: "Route not found" },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: meta.title || "RequestTap API",
      description: meta.description || "AI Agent API powered by RequestTap",
      version: "1.0.0",
      "x-requesttap-pay-to": meta.payToAddress,
    },
    servers: [{ url: meta.baseUrl }],
    tags,
    paths,
    components: {
      securitySchemes: {
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "X-PAYMENT",
          description:
            "x402 payment header. Contains a base64-encoded JSON payment object with payment proof for the requested resource.",
        },
        mandate: {
          type: "apiKey",
          in: "header",
          name: "X-MANDATE",
          description:
            "Base64-encoded JSON mandate object authorizing the agent to spend on behalf of the user.",
        },
      },
    },
    security: [{ x402Payment: [] }],
  };
}

function extractPathParams(path: string): object[] {
  const params: object[] = [];
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg.startsWith(":")) {
      params.push({
        name: seg.slice(1),
        in: "path",
        required: true,
        schema: { type: "string" },
      });
    }
  }
  return params;
}
