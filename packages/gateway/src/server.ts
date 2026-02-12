import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import type { GatewayConfig } from "./config.js";
import { type RouteRule, type CompiledRule, compileRoutes, matchRule, RouteNotFoundError } from "./routing.js";
import { InMemoryReplayStore } from "./replay.js";
import { SpendTracker } from "./ap2.js";
import { createIdempotencyMiddleware } from "./middleware/idempotency.js";
import { createMandateMiddleware } from "./middleware/mandate.js";
import { createPaymentSystem, type PaymentSystem } from "./middleware/payment.js";
import { createBiteService } from "./bite.js";
import { forwardRequest } from "./services/proxy.js";
import { ReceiptStore } from "./services/receipt-store.js";
import { hashBytes } from "./hash.js";
import { logger } from "./utils/logger.js";
import { createAdminRouter } from "./admin-routes.js";
import { ConfigStore } from "./services/config-store.js";
import { Outcome, ReasonCode, type Receipt, HEADERS } from "@requesttap/shared";

// Headers that must not be forwarded to upstream
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "content-length",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

const INTERNAL_HEADERS = new Set<string>([
  HEADERS.IDEMPOTENCY_KEY,
  HEADERS.MANDATE,
  HEADERS.PAYMENT,
  HEADERS.RECEIPT,
]);

export interface RouteManager {
  getRoutes(): RouteRule[];
  getCompiled(): CompiledRule[];
  addRoute(rule: RouteRule): void;
  removeRoute(toolId: string): boolean;
}

export interface CreateAppOptions {
  config: GatewayConfig;
  routes: RouteRule[];
}

export function createApp({ config, routes }: CreateAppOptions) {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors());
  app.use(rateLimit({ windowMs: 60_000, max: 100 }));
  app.use(express.json());

  // Services
  const replayStore = new InMemoryReplayStore();
  const spendTracker = new SpendTracker();
  const receiptStore = new ReceiptStore();
  const biteService = createBiteService(config);
  const paymentSystem: PaymentSystem = createPaymentSystem(config, routes);
  const startTime = Date.now();

  // Config persistence
  const routesFile = process.env.RT_ROUTES_FILE || "./routes.json";
  const configFilePath = routesFile.replace(/\.json$/, "") + ".rt-config.json";
  const configStore = new ConfigStore(configFilePath.startsWith(".") ? "./rt-config.json" : configFilePath);

  // Apply persisted config on startup
  const persistedConfig = configStore.load();
  if (persistedConfig.payToAddress) {
    (config as any).payToAddress = persistedConfig.payToAddress;
  }
  if (persistedConfig.baseNetwork) {
    (config as any).baseNetwork = persistedConfig.baseNetwork;
  }

  // Mutable route manager
  let currentRoutes = [...routes];
  let currentCompiled = compileRoutes(currentRoutes);
  const routeManager: RouteManager = {
    getRoutes: () => [...currentRoutes],
    getCompiled: () => currentCompiled,
    addRoute(rule: RouteRule) {
      currentRoutes.push(rule);
      currentCompiled = compileRoutes(currentRoutes);
    },
    removeRoute(toolId: string) {
      const idx = currentRoutes.findIndex((r) => r.tool_id === toolId);
      if (idx === -1) return false;
      currentRoutes.splice(idx, 1);
      currentCompiled = compileRoutes(currentRoutes);
      return true;
    },
  };

  // Health endpoint (public)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Admin API
  app.use("/admin", createAdminRouter({ routeManager, receiptStore, spendTracker, config, configStore, startTime }));

  // Gateway routes - catch all non-health requests
  app.use("/api/*", async (req, res) => {
    const requestId = uuidv4();
    (req as any).requestId = requestId;
    const startTime = performance.now();

    // 1. Route matching
    let matchResult;
    try {
      matchResult = matchRule(routeManager.getCompiled(), req.method, req.path);
    } catch (err) {
      if (err instanceof RouteNotFoundError) {
        const receipt: Receipt = {
          request_id: requestId,
          tool_id: "unknown",
          provider_id: "unknown",
          endpoint: req.path,
          method: req.method,
          timestamp: new Date().toISOString(),
          price_usdc: "0.00",
          currency: "USDC",
          chain: config.baseNetwork,
          mandate_id: null,
          mandate_hash: null,
          mandate_verdict: "SKIPPED",
          reason_code: ReasonCode.ROUTE_NOT_FOUND,
          payment_tx_hash: null,
          facilitator_receipt_id: null,
          request_hash: "",
          response_hash: null,
          latency_ms: null,
          outcome: Outcome.DENIED,
          explanation: `No route found for ${req.method} ${req.path}`,
        };
        receiptStore.add(receipt);
        res.status(404).json(receipt);
        return;
      }
      throw err;
    }

    // Store route info on request
    (req as any).toolId = matchResult.rule.tool_id;
    (req as any).providerId = matchResult.rule.provider.provider_id;
    (req as any).routePrice = matchResult.price;

    // 2. Idempotency check
    const idempotencyMw = createIdempotencyMiddleware(replayStore, config);
    const idempotencyResult = await new Promise<boolean>((resolve) => {
      idempotencyMw(req, res, () => resolve(true));
      // If middleware sends response, promise won't resolve via next()
      if (res.headersSent) resolve(false);
    });
    if (!idempotencyResult) return;

    // 3. Mandate verification
    const mandateMw = createMandateMiddleware(spendTracker, config);
    const mandateResult = await new Promise<boolean>((resolve) => {
      mandateMw(req, res, () => resolve(true));
      if (res.headersSent) resolve(false);
    });
    if (!mandateResult) return;

    // 4. Payment verification (x402)
    const paymentResult = await new Promise<boolean>((resolve) => {
      paymentSystem.middleware(req, res, () => resolve(true));
      if (res.headersSent) resolve(false);
    });
    if (!paymentResult) return;

    // 5. Proxy to upstream
    try {
      // Build forwarded headers: all client headers minus hop-by-hop and internal
      const proxyHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (HOP_BY_HOP.has(key) || INTERNAL_HEADERS.has(key)) continue;
        if (typeof value === "string") {
          proxyHeaders[key] = value;
        } else if (Array.isArray(value)) {
          proxyHeaders[key] = value.join(", ");
        }
      }

      // Preserve query string for upstream
      const qsIndex = req.originalUrl.indexOf("?");
      const queryString = qsIndex >= 0 ? req.originalUrl.substring(qsIndex) : "";

      const proxyRes = await forwardRequest(
        matchResult.rule.provider,
        req.method,
        req.path,
        proxyHeaders,
        req.body,
        queryString,
      );

      // 6. Settle payment after successful proxy
      const settlement = await paymentSystem.settle(req);

      const latencyMs = Math.round(performance.now() - startTime);
      const responseHash = hashBytes(JSON.stringify(proxyRes.data));

      const receipt: Receipt = {
        request_id: requestId,
        tool_id: matchResult.rule.tool_id,
        provider_id: matchResult.rule.provider.provider_id,
        endpoint: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        price_usdc: matchResult.price,
        currency: "USDC",
        chain: config.baseNetwork,
        mandate_id: (req as any).mandate?.mandate_id ?? null,
        mandate_hash: null,
        mandate_verdict: (req as any).mandateVerdict || "SKIPPED",
        reason_code: ReasonCode.OK,
        payment_tx_hash: settlement.txHash,
        facilitator_receipt_id: settlement.txHash,
        request_hash: (req as any).requestHash || "",
        response_hash: responseHash,
        latency_ms: latencyMs,
        outcome: Outcome.SUCCESS,
        explanation: "Request processed successfully",
      };

      receiptStore.add(receipt);
      res.setHeader(HEADERS.RECEIPT, Buffer.from(JSON.stringify(receipt)).toString("base64"));
      res.status(proxyRes.status).json(proxyRes.data);
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      logger.error("Proxy error", { error: String(err) });

      const receipt: Receipt = {
        request_id: requestId,
        tool_id: matchResult.rule.tool_id,
        provider_id: matchResult.rule.provider.provider_id,
        endpoint: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        price_usdc: "0.00",
        currency: "USDC",
        chain: config.baseNetwork,
        mandate_id: (req as any).mandate?.mandate_id ?? null,
        mandate_hash: null,
        mandate_verdict: (req as any).mandateVerdict || "SKIPPED",
        reason_code: ReasonCode.UPSTREAM_ERROR_NO_CHARGE,
        payment_tx_hash: null,
        facilitator_receipt_id: null,
        request_hash: (req as any).requestHash || "",
        response_hash: null,
        latency_ms: latencyMs,
        outcome: Outcome.ERROR,
        explanation: `Upstream error: ${err.message}`,
      };
      receiptStore.add(receipt);
      res.status(502).json(receipt);
    }
  });

  return { app, replayStore, receiptStore, spendTracker, routeManager };
}
