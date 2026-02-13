import type { Request, Response, NextFunction } from "express";
import { HEADERS, Outcome, ReasonCode } from "@requesttap/shared";
import type { Mandate, IntentMandate, Receipt } from "@requesttap/shared";
import { verifyMandate, verifyIntentMandate, intentMandateId, type SpendTracker, type LifetimeSpendTracker } from "../ap2.js";
import type { GatewayConfig } from "../config.js";

function isIntentMandate(obj: any): obj is IntentMandate {
  return obj.type === "IntentMandate" && obj.contents != null;
}

function resolveGatewayDomain(req: Request, config: GatewayConfig): string {
  if (config.gatewayDomain) return config.gatewayDomain;
  const host = req.headers.host || "localhost";
  // Strip port if present
  return host.replace(/:\d+$/, "");
}

export function createMandateMiddleware(spendTracker: SpendTracker, lifetimeTracker: LifetimeSpendTracker, config: GatewayConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const mandateHeader = req.headers[HEADERS.MANDATE] as string | undefined;
    if (!mandateHeader) {
      (req as any).mandateVerdict = "SKIPPED";
      next();
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(Buffer.from(mandateHeader, "base64").toString("utf-8"));
    } catch {
      res.status(400).json({ error: "Invalid X-Mandate header (malformed base64/JSON)" });
      return;
    }

    let verdict;
    let mandateId: string;

    if (isIntentMandate(parsed)) {
      const intentMandate = parsed as IntentMandate;
      verdict = await verifyIntentMandate(intentMandate, {
        price_usdc: (req as any).routePrice || "0",
        timestamp: new Date().toISOString(),
        gateway_domain: resolveGatewayDomain(req, config),
      }, lifetimeTracker);
      mandateId = intentMandateId(intentMandate.contents);
    } else {
      const mandate = parsed as Mandate;
      verdict = await verifyMandate(mandate, {
        tool_id: (req as any).toolId || "unknown",
        price_usdc: (req as any).routePrice || "0",
        timestamp: new Date().toISOString(),
      }, spendTracker);
      mandateId = mandate.mandate_id;
    }

    (req as any).mandate = parsed;
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
        mandate_id: mandateId,
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
