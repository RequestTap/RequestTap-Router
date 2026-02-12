import type { Request, Response, NextFunction } from "express";
import type { GatewayConfig } from "../config.js";

export function createPaymentMiddleware(_config: GatewayConfig) {
  // In production this would wrap @x402/express paymentMiddleware.
  // For now we implement a pass-through that checks for payment header
  // and can be swapped for the real x402 flow.
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // x402 payment verification would happen here.
    // The @x402/express middleware handles the 402 -> pay -> retry flow.
    // When integrated, it reads X-Payment header, verifies with facilitator,
    // and either proceeds or returns 402 Payment Required.
    next();
  };
}
