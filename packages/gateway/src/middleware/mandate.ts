import type { Request, Response, NextFunction } from "express";
import { HEADERS, Outcome, ReasonCode } from "@requesttap/shared";
import type { Mandate, Receipt } from "@requesttap/shared";
import { verifyMandate, type SpendTracker } from "../ap2.js";
import type { GatewayConfig } from "../config.js";

export function createMandateMiddleware(spendTracker: SpendTracker, config: GatewayConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const mandateHeader = req.headers[HEADERS.MANDATE] as string | undefined;
    if (!mandateHeader) {
      (req as any).mandateVerdict = "SKIPPED";
      next();
      return;
    }

    let mandate: Mandate;
    try {
      mandate = JSON.parse(Buffer.from(mandateHeader, "base64").toString("utf-8"));
    } catch {
      res.status(400).json({ error: "Invalid X-Mandate header (malformed base64/JSON)" });
      return;
    }

    const verdict = await verifyMandate(mandate, {
      tool_id: (req as any).toolId || "unknown",
      price_usdc: (req as any).routePrice || "0",
      timestamp: new Date().toISOString(),
    }, spendTracker);

    (req as any).mandate = mandate;
    (req as any).mandateVerdict = verdict.approved ? "APPROVED" : "DENIED";

    if (!verdict.approved) {
      const receipt: Receipt = {
        request_id: (req as any).requestId || "unknown",
        tool_id: (req as any).toolId || "unknown",
        provider_id: (req as any).providerId || "unknown",
        endpoint: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        price_usdc: (req as any).routePrice || "0",
        currency: "USDC",
        chain: config.baseNetwork,
        mandate_id: mandate.mandate_id,
        mandate_hash: null,
        mandate_verdict: "DENIED",
        reason_code: verdict.reason_code as ReasonCode,
        payment_tx_hash: null,
        facilitator_receipt_id: null,
        request_hash: (req as any).requestHash || "",
        response_hash: null,
        latency_ms: null,
        outcome: Outcome.DENIED,
        explanation: verdict.explanation,
      };
      res.status(403).json(receipt);
      return;
    }

    next();
  };
}
