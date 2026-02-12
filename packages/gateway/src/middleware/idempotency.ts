import type { Request, Response, NextFunction } from "express";
import { HEADERS, DEFAULTS, Outcome, ReasonCode } from "@requesttap/shared";
import type { Receipt } from "@requesttap/shared";
import { requestHash, hashBytes } from "../hash.js";
import { checkReplay, type ReplayStore } from "../replay.js";
import { v4 as uuidv4 } from "uuid";
import type { GatewayConfig } from "../config.js";

export function createIdempotencyMiddleware(store: ReplayStore, config: GatewayConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers[HEADERS.IDEMPOTENCY_KEY] as string | undefined;
    if (!idempotencyKey) {
      next();
      return;
    }

    const bodyStr = req.body ? JSON.stringify(req.body) : "";
    const bodyHash = hashBytes(bodyStr);
    const timeWindow = Math.floor(Date.now() / config.replayTtlMs).toString();

    const hash = requestHash({
      method: req.method,
      path: req.path,
      bodyHash,
      price: (req as any).routePrice || "0",
      idempotencyKey,
      timeWindow,
    });

    (req as any).requestHash = hash;
    (req as any).requestId = uuidv4();

    const isReplay = await checkReplay(store, hash, config.replayTtlMs);
    if (isReplay) {
      const receipt: Receipt = {
        request_id: (req as any).requestId,
        tool_id: (req as any).toolId || "unknown",
        provider_id: (req as any).providerId || "unknown",
        endpoint: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        price_usdc: "0.00",
        currency: "USDC",
        chain: config.baseNetwork,
        mandate_id: null,
        mandate_hash: null,
        mandate_verdict: "SKIPPED",
        reason_code: ReasonCode.REPLAY_DETECTED,
        payment_tx_hash: null,
        facilitator_receipt_id: null,
        request_hash: hash,
        response_hash: null,
        latency_ms: null,
        outcome: Outcome.DENIED,
        explanation: "Duplicate request detected (replay)",
      };
      res.status(409).json(receipt);
      return;
    }

    next();
  };
}
