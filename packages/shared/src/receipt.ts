export enum Outcome {
  SUCCESS = "SUCCESS",
  DENIED = "DENIED",
  ERROR = "ERROR",
  REFUNDED = "REFUNDED",
}

export enum ReasonCode {
  OK = "OK",
  MANDATE_BUDGET_EXCEEDED = "MANDATE_BUDGET_EXCEEDED",
  ENDPOINT_NOT_ALLOWLISTED = "ENDPOINT_NOT_ALLOWLISTED",
  MANDATE_EXPIRED = "MANDATE_EXPIRED",
  RATE_LIMITED = "RATE_LIMITED",
  REPLAY_DETECTED = "REPLAY_DETECTED",
  UPSTREAM_ERROR_NO_CHARGE = "UPSTREAM_ERROR_NO_CHARGE",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  INVALID_PAYMENT = "INVALID_PAYMENT",
  ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND",
  SSRF_BLOCKED = "SSRF_BLOCKED",
  X402_UPSTREAM_BLOCKED = "X402_UPSTREAM_BLOCKED",
  MANDATE_CONFIRM_REQUIRED = "MANDATE_CONFIRM_REQUIRED",
  UNAUTHORIZED = "UNAUTHORIZED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  AGENT_BLOCKED = "AGENT_BLOCKED",
  LOW_REPUTATION = "LOW_REPUTATION",
}

export interface Receipt {
  request_id: string;
  tool_id: string;
  provider_id: string;
  endpoint: string;
  method: string;
  timestamp: string;
  price_usdc: string;
  currency: "USDC";
  chain: string;
  mandate_id: string | null;
  mandate_hash: string | null;
  mandate_verdict: "APPROVED" | "DENIED" | "SKIPPED";
  reason_code: ReasonCode;
  payment_tx_hash: string | null;
  facilitator_receipt_id: string | null;
  request_hash: string;
  response_hash: string | null;
  latency_ms: number | null;
  outcome: Outcome;
  explanation: string;
}

export const EXAMPLE_SUCCESS_RECEIPT: Receipt = {
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  tool_id: "quote",
  provider_id: "acme-data",
  endpoint: "/api/v1/quote",
  method: "GET",
  timestamp: "2025-01-15T12:00:00.000Z",
  price_usdc: "0.01",
  currency: "USDC",
  chain: "base-sepolia",
  mandate_id: "mandate-001",
  mandate_hash: "0xabc123",
  mandate_verdict: "APPROVED",
  reason_code: ReasonCode.OK,
  payment_tx_hash: "0xdef456",
  facilitator_receipt_id: "fac-789",
  request_hash: "0x1234567890abcdef",
  response_hash: "0xfedcba0987654321",
  latency_ms: 142,
  outcome: Outcome.SUCCESS,
  explanation: "Request processed successfully",
};

export const EXAMPLE_DENIED_RECEIPT: Receipt = {
  request_id: "550e8400-e29b-41d4-a716-446655440001",
  tool_id: "premium-brief",
  provider_id: "acme-data",
  endpoint: "/api/v1/premium-brief",
  method: "POST",
  timestamp: "2025-01-15T12:00:01.000Z",
  price_usdc: "0.05",
  currency: "USDC",
  chain: "base-sepolia",
  mandate_id: "mandate-001",
  mandate_hash: "0xabc123",
  mandate_verdict: "DENIED",
  reason_code: ReasonCode.ENDPOINT_NOT_ALLOWLISTED,
  payment_tx_hash: null,
  facilitator_receipt_id: null,
  request_hash: "0xaaaaaaaaaaaaaaaa",
  response_hash: null,
  latency_ms: null,
  outcome: Outcome.DENIED,
  explanation: "Tool 'premium-brief' is not in the mandate allowlist",
};
