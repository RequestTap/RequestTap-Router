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
