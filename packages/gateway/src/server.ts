import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import type { GatewayConfig } from "./config.js";
import { type RouteRule, compileRoutes, matchRule, RouteNotFoundError } from "./routing.js";
import { InMemoryReplayStore } from "./replay.js";
import { SpendTracker } from "./ap2.js";
import { createIdempotencyMiddleware } from "./middleware/idempotency.js";
import { createMandateMiddleware } from "./middleware/mandate.js";
import { createPaymentMiddleware } from "./middleware/payment.js";
import { createBiteService } from "./bite.js";
import { forwardRequest } from "./services/proxy.js";
import { ReceiptStore } from "./services/receipt-store.js";
import { hashBytes } from "./hash.js";
import { logger } from "./utils/logger.js";
import { Outcome, ReasonCode, type Receipt, HEADERS } from "@requesttap/shared";

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
  const compiledRoutes = compileRoutes(routes);

  // Health endpoint (public)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Gateway routes - catch all non-health requests
  app.use("/api/*", async (req, res) => {
    const requestId = uuidv4();
    (req as any).requestId = requestId;
    const startTime = performance.now();

    // 1. Route matching
    let matchResult;
    try {
      matchResult = matchRule(compiledRoutes, req.method, req.path);
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

    // 4. Payment (x402 - pass-through for now)
    const paymentMw = createPaymentMiddleware(config);
    await new Promise<void>((resolve) => {
      paymentMw(req, res, () => resolve());
    });
    if (res.headersSent) return;

    // 5. Proxy to upstream
    try {
      const proxyHeaders: Record<string, string> = {};
      if (req.headers["content-type"]) {
        proxyHeaders["content-type"] = req.headers["content-type"] as string;
      }

      const proxyRes = await forwardRequest(
        matchResult.rule.provider,
        req.method,
        req.path,
        proxyHeaders,
        req.body,
      );

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
        payment_tx_hash: null,
        facilitator_receipt_id: null,
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

  return { app, replayStore, receiptStore, spendTracker };
}
