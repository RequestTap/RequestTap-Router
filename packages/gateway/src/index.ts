import { loadConfig, type GatewayConfig } from "./config.js";
import { createApp, type CreateAppOptions, type RouteManager } from "./server.js";
import type { RouteRule } from "./routing.js";
import { loadRoutesFromFile } from "./routes-loader.js";
import { logger } from "./utils/logger.js";
import { assertNotX402Upstream, X402UpstreamError } from "./utils/x402-probe.js";
import type { Express } from "express";
import type { Server } from "http";

export { loadConfig, type GatewayConfig } from "./config.js";
export { createApp, type RouteManager } from "./server.js";
export { type RouteRule, type ProviderConfig, type CompiledRule, type CompileOptions, compileRoutes, matchRule, RouteNotFoundError } from "./routing.js";
export { createAdminRouter } from "./admin-routes.js";
export { InMemoryReplayStore, checkReplay, type ReplayStore } from "./replay.js";
export { SpendTracker, verifyMandate, mandateSigningPayload } from "./ap2.js";
export { requestHash, hashBytes, canonicalString } from "./hash.js";
export { isPrivateOrReserved, assertNotSSRF, SSRFError } from "./utils/ssrf.js";
export { assertNotX402Upstream, X402UpstreamError } from "./utils/x402-probe.js";
export { ReceiptStore } from "./services/receipt-store.js";
export { createBiteService, type BiteService } from "./bite.js";
export { loadRoutesFromFile } from "./routes-loader.js";
export { createPaymentSystem, type PaymentSystem, type SettlementResult } from "./middleware/payment.js";

export interface Gateway {
  app: Express;
  config: GatewayConfig;
  routeManager: RouteManager;
  start(): Promise<Server>;
  stop(): Promise<void>;
}

export function createGateway(overrides?: {
  config?: Partial<GatewayConfig>;
  routes?: RouteRule[];
}): Gateway {
  const config = { ...loadConfig(), ...overrides?.config };

  // Load routes: from overrides, from file (RT_ROUTES_FILE env), or empty
  let routes = overrides?.routes;
  if (!routes) {
    const routesFile = process.env.RT_ROUTES_FILE;
    if (routesFile) {
      routes = loadRoutesFromFile(routesFile);
    } else {
      routes = [];
    }
  }

  const { app, replayStore, routeManager } = createApp({ config, routes });
  let server: Server | null = null;

  return {
    app,
    config,
    routeManager,
    async start() {
      // Probe routes for x402 upstream wrapping before accepting traffic
      const loaded = routeManager.getRoutes();
      for (const route of loaded) {
        try {
          await assertNotX402Upstream(route.provider.backend_url, route.path);
        } catch (err) {
          if (err instanceof X402UpstreamError) {
            logger.warn(
              `Skipping route "${route.tool_id}": upstream already supports x402 payments (${route.provider.backend_url})`,
            );
            routeManager.removeRoute(route.tool_id);
          }
        }
      }

      return new Promise((resolve) => {
        server = app.listen(config.port, () => {
          logger.info(`RequestTap Gateway listening on port ${config.port}`);
          resolve(server!);
        });
      });
    },
    async stop() {
      replayStore.destroy();
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => (err ? reject(err) : resolve()));
        });
        server = null;
      }
    },
  };
}

// CLI entrypoint
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const gw = createGateway();
  gw.start();
}
