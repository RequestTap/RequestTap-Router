import { loadConfig, type GatewayConfig } from "./config.js";
import { createApp, type CreateAppOptions } from "./server.js";
import type { RouteRule } from "./routing.js";
import { logger } from "./utils/logger.js";
import type { Express } from "express";
import type { Server } from "http";

export { loadConfig, type GatewayConfig } from "./config.js";
export { createApp } from "./server.js";
export { type RouteRule, type ProviderConfig, compileRoutes, matchRule, RouteNotFoundError } from "./routing.js";
export { InMemoryReplayStore, checkReplay, type ReplayStore } from "./replay.js";
export { SpendTracker, verifyMandate, mandateSigningPayload } from "./ap2.js";
export { requestHash, hashBytes, canonicalString } from "./hash.js";
export { isPrivateOrReserved, assertNotSSRF, SSRFError } from "./utils/ssrf.js";
export { ReceiptStore } from "./services/receipt-store.js";
export { createBiteService, type BiteService } from "./bite.js";

export interface Gateway {
  app: Express;
  config: GatewayConfig;
  start(): Promise<Server>;
  stop(): Promise<void>;
}

export function createGateway(overrides?: {
  config?: Partial<GatewayConfig>;
  routes?: RouteRule[];
}): Gateway {
  const config = { ...loadConfig(), ...overrides?.config };
  const routes = overrides?.routes || [];

  const { app, replayStore } = createApp({ config, routes });
  let server: Server | null = null;

  return {
    app,
    config,
    async start() {
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
