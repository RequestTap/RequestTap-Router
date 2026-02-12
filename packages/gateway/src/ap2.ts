import { keccak256, toHex, verifyMessage } from "viem";
import type { Mandate, MandateRequestContext, MandateVerdict } from "@requesttap/shared";
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
