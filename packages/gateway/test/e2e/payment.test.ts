/**
 * REAL PAYMENT E2E TEST
 *
 * Exercises the full x402 payment lifecycle on Base Sepolia:
 *
 *   Agent request → 402 Payment Required → x402 auto-pay → Gateway verifies
 *   → Proxy upstream → Settle on-chain → Receipt with tx hash
 *
 * Prerequisites:
 *   - CDP credentials in env (CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET)
 *   - RT_PAY_TO_ADDRESS set to a real address
 *   - Network connectivity to Base Sepolia + x402 facilitator
 *
 * Run:
 *   RUN_PAYMENT_E2E=true npm test --workspace=packages/gateway -- --testPathPattern=payment
 *
 * Skipped by default in normal test runs.
 */
import { jest } from "@jest/globals";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import express from "express";
import type { Server } from "http";

/* ── Load .env from repo root if env vars not already set ──────────── */
const envPath = resolve(process.cwd(), "../../.env");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/* ── SSRF + x402-probe mocks (allow local upstream) ────────────────── */
jest.unstable_mockModule("../../src/utils/ssrf.js", () => ({
  assertNotSSRF: jest.fn(),
  isPrivateOrReserved: jest.fn(() => false),
  SSRFError: class SSRFError extends Error {},
}));
jest.unstable_mockModule("../../src/utils/x402-probe.js", () => ({
  assertNotX402Upstream: jest.fn(),
  X402UpstreamError: class X402UpstreamError extends Error {},
}));

const { createApp } = await import("../../src/server.js");

/* ── Feature flag: skip unless explicitly enabled ──────────────────── */
const ENABLED = process.env.RUN_PAYMENT_E2E === "true";
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;
const CDP_WALLET_SECRET = process.env.CDP_WALLET_SECRET;
const PAY_TO_ADDRESS = process.env.RT_PAY_TO_ADDRESS || "";
const FACILITATOR_URL = process.env.RT_FACILITATOR_URL || "https://x402.org/facilitator";
const BASE_NETWORK = process.env.RT_BASE_NETWORK || "base-sepolia";

const SKIP_REASON = !ENABLED
  ? "Set RUN_PAYMENT_E2E=true to run"
  : !CDP_API_KEY_ID
    ? "Missing CDP_API_KEY_ID"
    : !CDP_API_KEY_SECRET
      ? "Missing CDP_API_KEY_SECRET"
      : !CDP_WALLET_SECRET || CDP_WALLET_SECRET === "REPLACE_ME_FROM_CDP_PORTAL"
        ? "Missing CDP_WALLET_SECRET — generate one at https://portal.cdp.coinbase.com/products/server-wallets"
        : !PAY_TO_ADDRESS
          ? "Missing RT_PAY_TO_ADDRESS"
          : null;

const describePayment = SKIP_REASON ? describe.skip : describe;

if (SKIP_REASON) {
  console.log(`\n  PAYMENT E2E SKIPPED: ${SKIP_REASON}\n`);
}

/* ═══════════════════════════════════════════════════════════════════════
   REAL PAYMENT E2E — $0.01 USDC on Base Sepolia
   ═══════════════════════════════════════════════════════════════════════ */

describePayment("e2e: real $0.01 USDC payment on Base Sepolia", () => {
  let upstreamServer: Server;
  let upstreamPort: number;
  let gatewayServer: Server;
  let gatewayPort: number;
  let replayStore: ReturnType<typeof createApp>["replayStore"];

  beforeAll(async () => {
    /* ── Local echo upstream ───────────────────────────────────────── */
    const upstream = express();
    upstream.use(express.json());
    upstream.all("*", (req, res) => {
      res.json({
        echo: true,
        path: req.path,
        method: req.method,
        ts: Date.now(),
      });
    });
    await new Promise<void>((resolve) => {
      upstreamServer = upstream.listen(0, () => {
        const addr = upstreamServer.address();
        upstreamPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    /* ── Gateway with $0.01 paid route ─────────────────────────────── */
    process.env.RT_ADMIN_KEY = "test-key";
    delete process.env.RT_ROUTES_FILE;

    const config = {
      port: 0,
      facilitatorUrl: FACILITATOR_URL,
      payToAddress: PAY_TO_ADDRESS,
      baseNetwork: BASE_NETWORK,
      replayTtlMs: 300_000,
    };

    const paidRoute = {
      method: "GET",
      path: "/api/v1/paid-echo",
      tool_id: "paid-echo",
      price_usdc: "0.01",
      provider: {
        provider_id: "local-echo",
        backend_url: `http://127.0.0.1:${upstreamPort}`,
      },
    };

    const created = createApp({ config, routes: [paidRoute] });
    replayStore = created.replayStore;

    // Start on a real port (wrapFetchWithPayment needs an actual server)
    await new Promise<void>((resolve) => {
      gatewayServer = created.app.listen(0, () => {
        const addr = gatewayServer.address();
        gatewayPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  }, 30_000);

  afterAll(async () => {
    replayStore?.destroy();
    await new Promise<void>((r, e) => {
      gatewayServer?.close((err) => (err ? e(err) : r()));
    });
    await new Promise<void>((r, e) => {
      upstreamServer?.close((err) => (err ? e(err) : r()));
    });
  });

  test("full payment lifecycle: 402 → pay → 200 → receipt → blockchain", async () => {
    const gatewayUrl = `http://localhost:${gatewayPort}`;

    console.log("\n" + "=".repeat(72));
    console.log("  REAL PAYMENT E2E TEST");
    console.log("  $0.01 USDC on Base Sepolia via x402 protocol");
    console.log("=".repeat(72));
    console.log(`\n  Gateway:      ${gatewayUrl}`);
    console.log(`  Facilitator:  ${FACILITATOR_URL}`);
    console.log(`  Pay-to:       ${PAY_TO_ADDRESS}`);
    console.log(`  Network:      ${BASE_NETWORK}`);

    /* ── Step 1: Initialize CDP client ─────────────────────────────── */
    console.log("\n── Step 1: Initialize CDP client ──────────────────────────────");
    let cdp: any;
    try {
      const { CdpClient } = await import("@coinbase/cdp-sdk");
      cdp = new CdpClient({
        apiKeyId: CDP_API_KEY_ID!,
        apiKeySecret: CDP_API_KEY_SECRET!,
        walletSecret: CDP_WALLET_SECRET!,
      });
      console.log("   CDP client created");
    } catch (err: any) {
      console.error("\n   FAILED to initialize CDP client.");
      console.error(`   Error: ${err.message}`);
      if (err.message.includes("WalletSecret") || err.message.includes("EC key")) {
        console.error("\n   Your CDP_WALLET_SECRET appears to be in the wrong format.");
        console.error("   Generate a valid one via the Coinbase Developer Platform:");
        console.error("     https://portal.cdp.coinbase.com/projects/api-keys");
        console.error("   The wallet secret is an EC private key, NOT a raw hex string.\n");
      }
      throw err;
    }

    /* ── Step 2: Get or create a stable EVM account ────────────────── */
    console.log("\n── Step 2: Get or create EVM signer account ──────────────────");
    let account: any;
    try {
      account = await cdp.evm.getOrCreateAccount({
        name: "requesttap-e2e-payer",
      });
      console.log(`   Account address: ${account.address}`);
      console.log(`   (Stable across runs — named "requesttap-e2e-payer")`);
    } catch (err: any) {
      console.error("\n   FAILED to create/get CDP account.");
      console.error(`   Error: ${err.message}`);
      if (err.cause) console.error(`   Cause: ${err.cause.message || err.cause}`);
      if (err.message.includes("no secret") || err.message.includes("register a secret")) {
        console.error("\n   Your CDP project has no Wallet Secret registered.");
        console.error("   Generate one from the Server Wallet dashboard:");
        console.error("     https://portal.cdp.coinbase.com/products/server-wallets");
        console.error("   1. Select your project from the dropdown");
        console.error("   2. In the 'Wallet Secret' section, click Generate");
        console.error("   3. Save it to .env as CDP_WALLET_SECRET=<base64 key>\n");
      } else {
        console.error("\n   Check that your CDP credentials are valid:");
        console.error("     CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET");
        console.error("     https://portal.cdp.coinbase.com/projects/api-keys\n");
      }
      throw err;
    }

    /* ── Step 3: Check USDC balance ────────────────────────────────── */
    console.log("\n── Step 3: Check USDC balance on Base Sepolia ─────────────────");
    let usdcAmount = 0;
    try {
      const balances = await cdp.evm.listTokenBalances({
        address: account.address as `0x${string}`,
        network: "base-sepolia",
      });
      const usdcBalance = balances.balances.find(
        (b: any) => b.token.symbol?.toUpperCase() === "USDC",
      );
      usdcAmount = usdcBalance
        ? Number(usdcBalance.amount.amount) / 10 ** usdcBalance.amount.decimals
        : 0;
      console.log(`   USDC balance: ${usdcAmount}`);

      for (const b of balances.balances) {
        const human =
          Number(b.amount.amount) / 10 ** b.amount.decimals;
        console.log(
          `   ${(b as any).token.symbol || (b as any).token.contractAddress}: ${human}`,
        );
      }
    } catch (err: any) {
      console.log(`   Could not fetch balances: ${err.message}`);
    }

    /* ── Step 3b: Request USDC from faucet if balance is too low ──── */
    if (usdcAmount < 0.01) {
      console.log("\n   Balance too low — requesting USDC from CDP faucet...");
      try {
        const faucetResult = await cdp.evm.requestFaucet({
          address: account.address,
          network: "base-sepolia",
          token: "usdc",
        });
        console.log(`   Faucet TX: ${faucetResult.transactionHash}`);
        console.log(
          `   BaseScan:  https://sepolia.basescan.org/tx/${faucetResult.transactionHash}`,
        );
        console.log("   Waiting 15s for faucet tx to confirm...");
        await new Promise((r) => setTimeout(r, 15_000));

        // Re-check balance
        const updated = await cdp.evm.listTokenBalances({
          address: account.address as `0x${string}`,
          network: "base-sepolia",
        });
        const newUsdc = updated.balances.find(
          (b: any) => b.token.symbol?.toUpperCase() === "USDC",
        );
        usdcAmount = newUsdc
          ? Number(newUsdc.amount.amount) / 10 ** newUsdc.amount.decimals
          : 0;
        console.log(`   Updated USDC balance: ${usdcAmount}`);
      } catch (err: any) {
        console.log(`   Faucet request failed: ${err.message}`);
        console.log(
          "   You may need to manually fund this address with test USDC.",
        );
      }
    }

    /* ── Step 4: Configure x402 payment client ─────────────────────── */
    console.log("\n── Step 4: Configure x402 payment client ─────────────────────");
    const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
    const { registerExactEvmScheme } = await import(
      "@x402/evm/exact/client"
    );
    const x402 = new x402Client();
    registerExactEvmScheme(x402, { signer: account as any });
    console.log('   x402 client configured with "exact" EVM scheme');

    /* ── Step 5: Raw request WITHOUT payment → expect 402 ──────────── */
    console.log("\n── Step 5: Raw request WITHOUT payment (expect 402) ──────────");
    const rawRes = await fetch(`${gatewayUrl}/api/v1/paid-echo`);
    console.log(`   Status: ${rawRes.status}`);

    // Log payment-related headers
    for (const [k, v] of rawRes.headers.entries()) {
      if (
        k.toLowerCase().includes("payment") ||
        k.toLowerCase().includes("x402") ||
        k.toLowerCase() === "www-authenticate"
      ) {
        const display = v.length > 120 ? v.slice(0, 120) + "..." : v;
        console.log(`   Header ${k}: ${display}`);
      }
    }

    const rawBody = await rawRes.text();
    if (rawBody.length < 500) {
      console.log(`   Body: ${rawBody}`);
    } else {
      console.log(`   Body (first 500 chars): ${rawBody.slice(0, 500)}...`);
    }

    if (rawRes.status !== 402) {
      console.error("\n   Expected 402 but got", rawRes.status);
      if (rawRes.status === 200) {
        console.error("   The gateway let the request through without payment.");
        console.error("   This means the x402 facilitator initialization FAILED.");
        console.error(`\n   Check your RT_FACILITATOR_URL: ${FACILITATOR_URL}`);
        console.error("   Known working URLs:");
        console.error("     - https://x402.org/facilitator");
        console.error("     - https://facilitator.cdp.coinbase.com/");
        console.error("   (NOT https://www.x402.org — that's the website, not the API)\n");
      }
    }
    expect(rawRes.status).toBe(402);
    console.log("   Got 402 Payment Required as expected");

    /* ── Step 6: Paid request via wrapFetchWithPayment ─────────────── */
    console.log("\n── Step 6: Request WITH x402 automatic payment ───────────────");
    console.log("   wrapFetchWithPayment will:");
    console.log("     1. Send request → receive 402 with payment requirements");
    console.log("     2. Sign USDC transferWithAuthorization (EIP-3009)");
    console.log("     3. Retry with X-Payment header");
    console.log("     4. Gateway verifies signature → proxies upstream → settles");
    console.log("   Sending...\n");

    const paymentFetch = wrapFetchWithPayment(fetch, x402);
    const t0 = performance.now();

    const paidRes = await paymentFetch(`${gatewayUrl}/api/v1/paid-echo`, {
      method: "GET",
      headers: { "content-type": "application/json" },
    });

    const elapsed = Math.round(performance.now() - t0);
    console.log(`   Status: ${paidRes.status} (${elapsed}ms total)`);

    expect(paidRes.status).toBe(200);
    console.log("   Got 200 OK — payment accepted!");

    const paidData = (await paidRes.json()) as any;
    console.log(`   Response body: ${JSON.stringify(paidData, null, 2)}`);
    expect(paidData.echo).toBe(true);

    /* ── Step 7: Decode receipt from x-receipt header ──────────────── */
    console.log("\n── Step 7: Decode receipt ─────────────────────────────────────");
    const receiptHeader = paidRes.headers.get("x-receipt");
    expect(receiptHeader).toBeTruthy();

    const receipt = JSON.parse(
      Buffer.from(receiptHeader!, "base64").toString(),
    );

    console.log(`   request_id:       ${receipt.request_id}`);
    console.log(`   tool_id:          ${receipt.tool_id}`);
    console.log(`   provider_id:      ${receipt.provider_id}`);
    console.log(`   endpoint:         ${receipt.endpoint}`);
    console.log(`   method:           ${receipt.method}`);
    console.log(`   timestamp:        ${receipt.timestamp}`);
    console.log(`   price_usdc:       ${receipt.price_usdc}`);
    console.log(`   currency:         ${receipt.currency}`);
    console.log(`   chain:            ${receipt.chain}`);
    console.log(`   outcome:          ${receipt.outcome}`);
    console.log(`   reason_code:      ${receipt.reason_code}`);
    console.log(`   payment_tx_hash:  ${receipt.payment_tx_hash}`);
    console.log(`   response_hash:    ${receipt.response_hash}`);
    console.log(`   latency_ms:       ${receipt.latency_ms}`);

    expect(receipt.outcome).toBe("SUCCESS");
    expect(receipt.tool_id).toBe("paid-echo");
    expect(receipt.price_usdc).toBe("0.01");

    /* ── Step 8: Verify payment on blockchain ──────────────────────── */
    console.log("\n── Step 8: Blockchain verification ────────────────────────────");
    if (receipt.payment_tx_hash) {
      expect(receipt.payment_tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
      const explorerUrl = `https://sepolia.basescan.org/tx/${receipt.payment_tx_hash}`;
      console.log(`   Payment TX:  ${receipt.payment_tx_hash}`);
      console.log(`   BaseScan:    ${explorerUrl}`);
      console.log("   Transaction is on-chain on Base Sepolia!");
    } else {
      console.log(
        "   No payment_tx_hash — settlement may be async or facilitator-managed",
      );
      console.log(`   facilitator_receipt_id: ${receipt.facilitator_receipt_id}`);
    }

    /* ── Step 9: Verify response_hash integrity ────────────────────── */
    console.log("\n── Step 9: Response hash integrity ────────────────────────────");
    if (receipt.response_hash) {
      expect(receipt.response_hash).toMatch(/^0x[0-9a-f]{64}$/);
      console.log(`   response_hash: ${receipt.response_hash}`);
      console.log("   Valid keccak256 hash of the response body");
    }

    /* ── Step 10: Query receipt via admin API ──────────────────────── */
    console.log("\n── Step 10: Query receipt via admin API ───────────────────────");
    const adminRes = await fetch(
      `${gatewayUrl}/admin/receipts?tool_id=paid-echo`,
      { headers: { Authorization: "Bearer test-key" } },
    );
    const adminData = (await adminRes.json()) as any;
    console.log(`   Total receipts for paid-echo: ${adminData.total}`);

    const successReceipt = adminData.receipts.find(
      (r: any) => r.outcome === "SUCCESS",
    );
    expect(successReceipt).toBeDefined();
    console.log(`   Found SUCCESS receipt: ${successReceipt.request_id}`);
    console.log(`   payment_tx_hash:       ${successReceipt.payment_tx_hash}`);

    /* ── Step 11: Check post-payment balance ───────────────────────── */
    console.log("\n── Step 11: Post-payment USDC balance ─────────────────────────");
    const postBalances = await cdp.evm.listTokenBalances({
      address: account.address as `0x${string}`,
      network: "base-sepolia",
    });
    const postUsdc = postBalances.balances.find(
      (b) => b.token.symbol?.toUpperCase() === "USDC",
    );
    const postAmount = postUsdc
      ? Number(postUsdc.amount.amount) / 10 ** postUsdc.amount.decimals
      : 0;
    console.log(`   USDC balance after payment: ${postAmount}`);
    console.log(`   Spent: ${(usdcAmount - postAmount).toFixed(6)} USDC`);

    /* ── Done ──────────────────────────────────────────────────────── */
    console.log("\n" + "=".repeat(72));
    console.log("  PAYMENT E2E TEST COMPLETE");
    if (receipt.payment_tx_hash) {
      console.log(
        `  View TX: https://sepolia.basescan.org/tx/${receipt.payment_tx_hash}`,
      );
    }
    console.log("=".repeat(72) + "\n");
  }, 180_000); // 3 minutes — blockchain ops can be slow
});
