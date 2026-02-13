import { keccak256, toHex, verifyMessage } from "viem";
import type { Mandate, MandateRequestContext, MandateVerdict, IntentMandate, IntentMandateContents, IntentMandateRequestContext } from "@requesttap/shared";
import { ReasonCode } from "@requesttap/shared";

export class SpendTracker {
  private dailyTotals = new Map<string, { total: number; date: string }>();

  private todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
  }

  getSpent(mandateId: string): number {
    const entry = this.dailyTotals.get(mandateId);
    if (!entry || entry.date !== this.todayUTC()) return 0;
    return entry.total;
  }

  addSpend(mandateId: string, amount: number): void {
    const today = this.todayUTC();
    const entry = this.dailyTotals.get(mandateId);
    if (!entry || entry.date !== today) {
      this.dailyTotals.set(mandateId, { total: amount, date: today });
    } else {
      entry.total += amount;
    }
  }
}

// Lifetime spend tracker for IntentMandates (no daily reset — resets on gateway restart)
export class LifetimeSpendTracker {
  private totals = new Map<string, number>();

  getSpent(key: string): number {
    return this.totals.get(key) ?? 0;
  }

  addSpend(key: string, amount: number): void {
    this.totals.set(key, (this.totals.get(key) ?? 0) + amount);
  }
}

function sortedStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(sortedStringify).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + sortedStringify((obj as any)[k])).join(",") + "}";
}

export function intentMandateSigningPayload(contents: IntentMandateContents): `0x${string}` {
  return keccak256(toHex(sortedStringify(contents)));
}

export function intentMandateId(contents: IntentMandateContents): string {
  const hash = intentMandateSigningPayload(contents);
  return "intent-" + hash.slice(2, 18);
}

export async function verifyIntentMandate(
  mandate: IntentMandate,
  context: IntentMandateRequestContext,
  lifetimeTracker: LifetimeSpendTracker,
): Promise<MandateVerdict> {
  // 1. Verify signature (EIP-191 personal sign over keccak256 of sorted contents)
  try {
    const hash = intentMandateSigningPayload(mandate.contents);
    const valid = await verifyMessage({
      address: mandate.signer_address as `0x${string}`,
      message: { raw: hash },
      signature: mandate.user_signature as `0x${string}`,
    });
    if (!valid) {
      return {
        approved: false,
        reason_code: ReasonCode.INVALID_SIGNATURE,
        explanation: "IntentMandate signature does not match signer_address",
      };
    }
  } catch {
    return {
      approved: false,
      reason_code: ReasonCode.INVALID_SIGNATURE,
      explanation: "Failed to verify IntentMandate signature",
    };
  }

  // 2. Check expiry
  if (new Date(mandate.contents.intent_expiry) < new Date(context.timestamp)) {
    return {
      approved: false,
      reason_code: ReasonCode.MANDATE_EXPIRED,
      explanation: `IntentMandate expired at ${mandate.contents.intent_expiry}`,
    };
  }

  // 3. Check merchant matching (case-insensitive)
  const domain = context.gateway_domain.toLowerCase();
  const matched = mandate.contents.merchants.some((m) => m.toLowerCase() === domain);
  if (!matched) {
    return {
      approved: false,
      reason_code: ReasonCode.MERCHANT_NOT_MATCHED,
      explanation: `Gateway domain '${context.gateway_domain}' not in merchants list`,
    };
  }

  // 4. Check lifetime budget
  // TODO: Assumes 1 USD = 1 USDC (stablecoin equivalence)
  const price = parseFloat(context.price_usdc);
  const mandateKey = intentMandateId(mandate.contents);
  const spent = lifetimeTracker.getSpent(mandateKey);
  if (spent + price > mandate.contents.budget.amount) {
    return {
      approved: false,
      reason_code: ReasonCode.INTENT_BUDGET_EXCEEDED,
      explanation: `Spent ${spent} + ${price} exceeds lifetime budget of ${mandate.contents.budget.amount} ${mandate.contents.budget.currency}`,
    };
  }

  // All checks passed — record spend
  lifetimeTracker.addSpend(mandateKey, price);

  return {
    approved: true,
    reason_code: ReasonCode.OK,
    explanation: "IntentMandate approved",
  };
}

export function mandateSigningPayload(mandate: Mandate): `0x${string}` {
  const canonical = [
    mandate.mandate_id,
    mandate.owner_pubkey,
    mandate.expires_at,
    mandate.max_spend_usdc_per_day,
    mandate.allowlisted_tool_ids.sort().join(","),
    mandate.require_user_confirm_for_price_over ?? "",
  ].join("|");

  return keccak256(toHex(canonical));
}

export async function verifyMandate(
  mandate: Mandate,
  context: MandateRequestContext,
  spendTracker: SpendTracker,
): Promise<MandateVerdict> {
  // 1. Verify signature (EIP-191 personal sign over keccak256 payload)
  try {
    const hash = mandateSigningPayload(mandate);
    const valid = await verifyMessage({
      address: mandate.owner_pubkey as `0x${string}`,
      message: { raw: hash },
      signature: mandate.signature as `0x${string}`,
    });
    if (!valid) {
      return {
        approved: false,
        reason_code: ReasonCode.INVALID_SIGNATURE,
        explanation: "Mandate signature does not match owner_pubkey",
      };
    }
  } catch {
    return {
      approved: false,
      reason_code: ReasonCode.INVALID_SIGNATURE,
      explanation: "Failed to verify mandate signature",
    };
  }

  // 2. Check expiry
  if (new Date(mandate.expires_at) < new Date(context.timestamp)) {
    return {
      approved: false,
      reason_code: ReasonCode.MANDATE_EXPIRED,
      explanation: `Mandate expired at ${mandate.expires_at}`,
    };
  }

  // 3. Check tool allowlist
  if (!mandate.allowlisted_tool_ids.includes(context.tool_id)) {
    return {
      approved: false,
      reason_code: ReasonCode.ENDPOINT_NOT_ALLOWLISTED,
      explanation: `Tool '${context.tool_id}' is not in the mandate allowlist`,
    };
  }

  // 4. Check daily budget
  const price = parseFloat(context.price_usdc);
  const spent = spendTracker.getSpent(mandate.mandate_id);
  const maxDaily = parseFloat(mandate.max_spend_usdc_per_day);
  if (spent + price > maxDaily) {
    return {
      approved: false,
      reason_code: ReasonCode.MANDATE_BUDGET_EXCEEDED,
      explanation: `Spent ${spent} + ${price} exceeds daily limit of ${maxDaily} USDC`,
    };
  }

  // 5. Check confirmation threshold
  if (
    mandate.require_user_confirm_for_price_over &&
    price > parseFloat(mandate.require_user_confirm_for_price_over)
  ) {
    return {
      approved: false,
      reason_code: ReasonCode.MANDATE_CONFIRM_REQUIRED,
      explanation: `Price ${price} exceeds confirmation threshold of ${mandate.require_user_confirm_for_price_over} USDC`,
    };
  }

  // All checks passed - record spend
  spendTracker.addSpend(mandate.mandate_id, price);

  return {
    approved: true,
    reason_code: ReasonCode.OK,
    explanation: "Mandate approved",
  };
}
