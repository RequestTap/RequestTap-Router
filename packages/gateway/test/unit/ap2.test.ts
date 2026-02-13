import { verifyMandate, SpendTracker, mandateSigningPayload, verifyIntentMandate, LifetimeSpendTracker, intentMandateSigningPayload } from "../../src/ap2.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Mandate, MandateRequestContext, IntentMandate, IntentMandateContents, IntentMandateRequestContext } from "@requesttap/shared";

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

// --- AP2 IntentMandate tests ---

function makeIntentContents(overrides: Partial<IntentMandateContents> = {}): IntentMandateContents {
  return {
    natural_language_description: "Allow API calls up to budget",
    budget: { amount: 1.0, currency: "USD" },
    merchants: ["localhost", "example.com"],
    intent_expiry: new Date(Date.now() + 86400000).toISOString(),
    requires_refundability: false,
    ...overrides,
  };
}

async function createSignedIntentMandate(
  contentsOverrides: Partial<IntentMandateContents> = {},
): Promise<IntentMandate> {
  const contents = makeIntentContents(contentsOverrides);
  const hash = intentMandateSigningPayload(contents);
  const signature = await testAccount.signMessage({ message: { raw: hash } });

  return {
    type: "IntentMandate",
    contents,
    user_signature: signature,
    timestamp: new Date().toISOString(),
    signer_address: testAccount.address,
  };
}

function makeIntentContext(overrides: Partial<IntentMandateRequestContext> = {}): IntentMandateRequestContext {
  return {
    price_usdc: "0.01",
    timestamp: new Date().toISOString(),
    gateway_domain: "localhost",
    ...overrides,
  };
}

describe("AP2 IntentMandate verification", () => {
  let lifetimeTracker: LifetimeSpendTracker;

  beforeEach(() => {
    lifetimeTracker = new LifetimeSpendTracker();
  });

  test("APPROVED for valid IntentMandate", async () => {
    const mandate = await createSignedIntentMandate();
    const verdict = await verifyIntentMandate(mandate, makeIntentContext(), lifetimeTracker);
    expect(verdict.approved).toBe(true);
    expect(verdict.reason_code).toBe("OK");
  });

  test("DENIED for expired IntentMandate", async () => {
    const mandate = await createSignedIntentMandate({
      intent_expiry: "2020-01-01T00:00:00.000Z",
    });
    const verdict = await verifyIntentMandate(mandate, makeIntentContext(), lifetimeTracker);
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("MANDATE_EXPIRED");
  });

  test("DENIED for merchant not matched", async () => {
    const mandate = await createSignedIntentMandate({
      merchants: ["other-gateway.com"],
    });
    const verdict = await verifyIntentMandate(
      mandate,
      makeIntentContext({ gateway_domain: "localhost" }),
      lifetimeTracker,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("MERCHANT_NOT_MATCHED");
  });

  test("DENIED immediate budget rejection (budget=0.01, price=0.02)", async () => {
    const mandate = await createSignedIntentMandate({
      budget: { amount: 0.01, currency: "USD" },
    });
    const verdict = await verifyIntentMandate(
      mandate,
      makeIntentContext({ price_usdc: "0.02" }),
      lifetimeTracker,
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("INTENT_BUDGET_EXCEEDED");
  });

  test("DENIED cumulative budget exceeded", async () => {
    const mandate = await createSignedIntentMandate({
      budget: { amount: 0.05, currency: "USD" },
    });

    // First request: 0.03 — should pass
    const v1 = await verifyIntentMandate(
      mandate,
      makeIntentContext({ price_usdc: "0.03" }),
      lifetimeTracker,
    );
    expect(v1.approved).toBe(true);

    // Second request: 0.03 — cumulative 0.06 > 0.05 budget
    const v2 = await verifyIntentMandate(
      mandate,
      makeIntentContext({ price_usdc: "0.03" }),
      lifetimeTracker,
    );
    expect(v2.approved).toBe(false);
    expect(v2.reason_code).toBe("INTENT_BUDGET_EXCEEDED");
  });

  test("DENIED for invalid signature", async () => {
    const mandate = await createSignedIntentMandate();
    mandate.user_signature = "0x" + "ab".repeat(65);

    const verdict = await verifyIntentMandate(mandate, makeIntentContext(), lifetimeTracker);
    expect(verdict.approved).toBe(false);
    expect(verdict.reason_code).toBe("INVALID_SIGNATURE");
  });
});
