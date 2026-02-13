export interface Mandate {
  mandate_id: string;
  owner_pubkey: string;
  expires_at: string;
  max_spend_usdc_per_day: string;
  allowlisted_tool_ids: string[];
  require_user_confirm_for_price_over?: string;
  signature: string;
}

export interface MandateRequestContext {
  tool_id: string;
  price_usdc: string;
  timestamp: string;
}

export interface MandateVerdict {
  approved: boolean;
  reason_code: string;
  explanation: string;
}

export interface IntentMandateBudget {
  amount: number;
  currency: string;
}

export interface IntentMandateContents {
  natural_language_description: string;
  budget: IntentMandateBudget;
  merchants: string[];
  intent_expiry: string;
  requires_refundability: boolean;
  constraints?: Record<string, string>;
}

export interface IntentMandate {
  type: "IntentMandate";
  contents: IntentMandateContents;
  user_signature: string;
  timestamp: string;
  signer_address: string;
}

export type AnyMandate = Mandate | IntentMandate;

export interface IntentMandateRequestContext {
  price_usdc: string;
  timestamp: string;
  gateway_domain: string;
}
