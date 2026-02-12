import type { ProviderConfig } from "../routing.js";
import { logger } from "../utils/logger.js";

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
  latencyMs: number;
}

export async function forwardRequest(
  provider: ProviderConfig,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<ProxyResponse> {
  const url = `${provider.backend_url.replace(/\/$/, "")}${path}`;
  const outHeaders: Record<string, string> = { ...headers };

  // Remove hop-by-hop headers
  delete outHeaders["host"];
  delete outHeaders["connection"];
  delete outHeaders["transfer-encoding"];

  // Add provider auth
  if (provider.auth) {
    outHeaders[provider.auth.header] = provider.auth.value;
  }

  const start = performance.now();

  try {
    const res = await fetch(url, {
      method,
      headers: outHeaders,
      body: body && method !== "GET" && method !== "HEAD"
        ? JSON.stringify(body)
        : undefined,
    });

    const latencyMs = Math.round(performance.now() - start);
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { responseHeaders[k] = v; });

    let data: unknown;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    return { status: res.status, headers: responseHeaders, data, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    logger.error("Upstream request failed", { url, error: String(err) });
    throw Object.assign(new Error(`Upstream request failed: ${err}`), { latencyMs });
  }
}
