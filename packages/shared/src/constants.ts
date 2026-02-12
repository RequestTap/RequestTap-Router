export const HEADERS = {
  IDEMPOTENCY_KEY: "x-request-idempotency-key",
  PAYMENT: "x-payment",
  PAYMENT_REQUIRED: "payment-required",
  MANDATE: "x-mandate",
  RECEIPT: "x-receipt",
} as const;

export const DEFAULTS = {
  REPLAY_TTL_MS: 5 * 60 * 1000,
  PORT: 4402,
  USDC_DECIMALS: 6,
} as const;
