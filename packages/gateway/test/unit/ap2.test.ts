import { verifyMandate, SpendTracker, mandateSigningPayload } from "../../src/ap2.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Mandate, MandateRequestContext } from "@requesttap/shared";

// Generate a test account for signing
const testPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const testAccount = privateKeyToAccount(testPrivateKey);

async function createSignedMandate(overrides: Partial<Mandate> = {}): Promise<Mandate> {
  const mandate: Mandate = {
    mandate_id: "test-mandate-001",
    owner_pubkey: testAccount.address,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    max_spend_usdc_per_day: "1.00",
    allowlisted_tool_ids: ["quote", "search"],
    signature: "0x",
    ...overrides,
  };

  // Sign the mandate
  const payload = mandateSigningPayload(mandate);
  mandate.signature = await testAccount.signMessage({ message: { raw: payload } });

  return mandate;
}

function makeContext(overrides: Partial<MandateRequestContext> = {}): MandateRequestContext {
  return {
    tool_id: "quote",
    price_usdc: "0.01",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("AP2 mandate verification", () => {
  let spendTracker: SpendTracker;

  beforeEach(() => {
    spendTracker = new SpendTracker();
  });

  test("APPROVED for valid mandate", async () => {
    const mandate = await createSignedMandate();
    const verdict = await verifyMandate(mandate, makeContext(), spendTracker);
    expect(verdict.approved).toBe(true);
    expect(verdict.reason_code).toBe("OK");
  });

  test("DENIED for expired mandate", async () => {
    const mandate = await createSignedMandate({
      expires_at: "2020-01-01T00:00:00.000Z",
    });
    // Re-sign with updated expiry
    const payload = mandateSigningPayload(mandate);
    mandate.signature = await testAccount.signMessage({ message: { raw: payload } });

    const verdict = await verifyMandate(mandate, makeContext(), spendTracker);
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("MANDATE_EXPIRED");
  });

  test("DENIED for tool not allowlisted", async () => {
    const mandate = await createSignedMandate();
    const verdict = await verifyMandate(
      mandate,
      makeContext({ tool_id: "premium-brief" }),
      spendTracker,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("ENDPOINT_NOT_ALLOWLISTED");
  });

  test("DENIED for budget exceeded", async () => {
    const mandate = await createSignedMandate({ max_spend_usdc_per_day: "0.05" });
    const payload = mandateSigningPayload(mandate);
    mandate.signature = await testAccount.signMessage({ message: { raw: payload } });

    // Spend enough to exceed budget
    spendTracker.addSpend(mandate.mandate_id, 0.04);

    const verdict = await verifyMandate(
      mandate,
      makeContext({ price_usdc: "0.02" }),
      spendTracker,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("MANDATE_BUDGET_EXCEEDED");
  });

  test("DENIED for invalid signature", async () => {
    const mandate = await createSignedMandate();
    mandate.signature = "0x" + "ab".repeat(65); // invalid signature

    const verdict = await verifyMandate(mandate, makeContext(), spendTracker);
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("INVALID_SIGNATURE");
  });

  test("DENIED for price over confirmation threshold", async () => {
    const mandate = await createSignedMandate({
      require_user_confirm_for_price_over: "0.005",
    });
    const payload = mandateSigningPayload(mandate);
    mandate.signature = await testAccount.signMessage({ message: { raw: payload } });

    const verdict = await verifyMandate(
      mandate,
      makeContext({ price_usdc: "0.01" }),
      spendTracker,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("MANDATE_CONFIRM_REQUIRED");
  });
});
