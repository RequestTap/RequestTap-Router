#!/usr/bin/env npx tsx
/**
 * Standalone x402 Provider Integration Test
 *
 * Tests any x402-enabled provider both directly and through the RequestTap gateway.
 * Auto-discovers routes from the provider's route catalog, then exercises
 * free health checks, 402 probes, and real x402 payments.
 *
 * Wallet: generates a local private key on first run and stores it in
 * test/.wallet.json (gitignored). Fund the printed address with USDC
 * on the target network before running paid tests.
 *
 * Usage:
 *   npx tsx scripts/test-x402-provider.ts <provider-url> [options]
 *
 * Examples:
 *   npx tsx scripts/test-x402-provider.ts https://stockmarketapi.ai
 *   npx tsx scripts/test-x402-provider.ts https://my-api.com --dry-run
 *   npx tsx scripts/test-x402-provider.ts https://my-api.com --gateway http://localhost:4402
 *   npx tsx scripts/test-x402-provider.ts https://my-api.com --skip-gateway
 *
 * Options:
 *   --gateway <url>   Gateway URL (default: http://localhost:4402)
 *   --admin-key <key> Admin API key for gateway route management
 *   --skip-direct     Skip direct-to-provider tests
 *   --skip-gateway    Skip gateway proxy tests
 *   --dry-run         Discover + 402 probe only, no real payments
 *   --network <name>  Override network (default: from RT_BASE_NETWORK or base-sepolia)
 *
 * Prerequisites:
 *   - Fund the wallet address shown at startup with USDC on the target network
 *   - Provider running with x402 payment middleware
 *   - Gateway running (for gateway tests)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, formatUnits } from "viem";
import { base, baseSepolia } from "viem/chains";

/* ── Load .env from repo root ──────────────────────────────────────── */
const envPath = resolve(process.cwd(), ".env");
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

/* ── Parse CLI args ────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const providerUrl = args.find((a) => !a.startsWith("--"));
if (!providerUrl) {
  console.error("Usage: npx tsx scripts/test-x402-provider.ts <provider-url> [options]");
  console.error("");
  console.error("Options:");
  console.error("  --gateway <url>   Gateway URL (default: http://localhost:4402)");
  console.error("  --admin-key <key> Admin API key for gateway");
  console.error("  --skip-direct     Skip direct-to-provider tests");
  console.error("  --skip-gateway    Skip gateway proxy tests");
  console.error("  --dry-run         Discover + 402 probe only, no real payments");
  console.error("  --network <name>  Override network (default: from RT_BASE_NETWORK or base-sepolia)");
  process.exit(1);
}

function getFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function getOption(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

const gatewayUrl = getOption("gateway", process.env.RT_GATEWAY_URL || "http://localhost:4402").replace(/\/$/, "");
const adminKey = getOption("admin-key", process.env.RT_ADMIN_KEY || "");
const skipDirect = getFlag("skip-direct");
const skipGateway = getFlag("skip-gateway");
const dryRun = getFlag("dry-run");
const BASE_NETWORK = getOption("network", process.env.RT_BASE_NETWORK || "base-sepolia");

/* ── Local wallet management ───────────────────────────────────────── */
const WALLET_PATH = resolve(process.cwd(), "test", ".wallet.json");

interface WalletFile {
  privateKey: `0x${string}`;
  address: string;
  createdAt: string;
}

function loadOrCreateWallet(): { privateKey: `0x${string}`; address: string } {
  if (existsSync(WALLET_PATH)) {
    const data: WalletFile = JSON.parse(readFileSync(WALLET_PATH, "utf-8"));
    const account = privateKeyToAccount(data.privateKey);
    return { privateKey: data.privateKey, address: account.address };
  }

  // Create test/ directory if needed
  const dir = dirname(WALLET_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const walletData: WalletFile = {
    privateKey,
    address: account.address,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(WALLET_PATH, JSON.stringify(walletData, null, 2));
  return { privateKey, address: account.address };
}

/* ── USDC balance check via viem ───────────────────────────────────── */
// USDC contract addresses per network
const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const ERC20_BALANCE_ABI = [{
  inputs: [{ name: "account", type: "address" }],
  name: "balanceOf",
  outputs: [{ name: "", type: "uint256" }],
  stateMutability: "view",
  type: "function",
}] as const;

async function getUsdcBalance(address: `0x${string}`): Promise<number> {
  const isMainnet = BASE_NETWORK === "base" || BASE_NETWORK === "base-mainnet";
  const chain = isMainnet ? base : baseSepolia;
  const usdcAddress = USDC_ADDRESSES[BASE_NETWORK];
  if (!usdcAddress) return -1; // unknown network

  const client = createPublicClient({ chain, transport: http() });
  const raw = await client.readContract({
    address: usdcAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return Number(formatUnits(raw, 6));
}

/* ── Helpers ───────────────────────────────────────────────────────── */
const DLINE = "\u2550".repeat(72);
let stepNum = 0;

function step(title: string): void {
  stepNum++;
  console.log(`\n\u2500\u2500 Step ${stepNum}: ${title} ${"\u2500".repeat(Math.max(0, 56 - title.length))}`);
}

function pass(msg: string): void {
  console.log(`   \u2713 ${msg}`);
}

function fail(msg: string): void {
  console.log(`   \u2717 ${msg}`);
}

function info(msg: string): void {
  console.log(`   ${msg}`);
}

interface DiscoveredRoute {
  method: string;
  path: string;
  tool_id: string;
  price_usdc: string;
  description?: string;
  provider?: { provider_id: string; backend_url: string };
}

/* ── Main ──────────────────────────────────────────────────────────── */
async function main(): Promise<void> {
  const provider = providerUrl!.replace(/\/$/, "");

  console.log(`\n${DLINE}`);
  console.log("  x402 Provider Integration Test");
  console.log(DLINE);
  info(`Provider:     ${provider}`);
  info(`Gateway:      ${gatewayUrl}`);
  info(`Network:      ${BASE_NETWORK}`);
  info(`Dry run:      ${dryRun}`);
  info(`Skip direct:  ${skipDirect}`);
  info(`Skip gateway: ${skipGateway}`);

  /* ── Load / create local wallet ────────────────────────────────── */
  const wallet = loadOrCreateWallet();
  const account = privateKeyToAccount(wallet.privateKey);

  info(`Wallet:       ${wallet.address}`);
  info(`Wallet file:  ${WALLET_PATH}`);

  if (!existsSync(WALLET_PATH.replace(".wallet.json", ""))) {
    // First run — extra visibility
    console.log("");
    info("NEW WALLET CREATED — fund this address with USDC before running paid tests.");
  }

  // Check USDC balance
  let usdcBalance = 0;
  try {
    usdcBalance = await getUsdcBalance(wallet.address as `0x${string}`);
    info(`USDC balance: ${usdcBalance} (${BASE_NETWORK})`);
  } catch (err: any) {
    info(`USDC balance: unknown (${err.message})`);
  }

  const isMainnet = BASE_NETWORK === "base" || BASE_NETWORK === "base-mainnet";
  const explorerBase = isMainnet ? "https://basescan.org" : "https://sepolia.basescan.org";
  info(`Explorer:     ${explorerBase}/address/${wallet.address}`);

  /* ── Step 1: Discover routes ───────────────────────────────────── */
  step("Discover provider routes");

  let routes: DiscoveredRoute[] = [];

  // Try multiple discovery endpoints
  const discoveryPaths = [
    "/api/v1/agentic/routes",
    "/docs",
    "/admin/routes",
  ];

  for (const path of discoveryPaths) {
    const url = `${provider}${path}`;
    try {
      const headers: Record<string, string> = {};
      if (path.startsWith("/admin") && adminKey) {
        headers["Authorization"] = `Bearer ${adminKey}`;
      }
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        info(`${path} \u2192 ${res.status} (skipping)`);
        continue;
      }
      const data = await res.json() as any;

      // Parse different response shapes
      if (data.routes && Array.isArray(data.routes)) {
        // Admin-style: { routes: [...] }
        routes = data.routes;
        pass(`Found ${routes.length} routes via ${path}`);
        break;
      } else if (data.paths && typeof data.paths === "object") {
        // OpenAPI-style: { paths: { "/api/...": { get: { ... } } } }
        for (const [p, methods] of Object.entries(data.paths) as any) {
          for (const [m, spec] of Object.entries(methods) as any) {
            if (m === "parameters") continue;
            const priceExt = spec["x-price-usdc"] || spec["x-requesttap-price"] || "0.00";
            routes.push({
              method: m.toUpperCase(),
              path: p,
              tool_id: spec.operationId || `${m}-${p.replace(/\//g, "-")}`,
              price_usdc: String(priceExt),
              description: spec.summary || spec.description,
            });
          }
        }
        if (routes.length > 0) {
          pass(`Found ${routes.length} routes via OpenAPI at ${path}`);
          break;
        }
      }
    } catch (err: any) {
      info(`${path} \u2192 ${err.message}`);
    }
  }

  if (routes.length === 0) {
    fail("No routes discovered. Check that the provider is running and exposes route metadata.");
    process.exit(1);
  }

  // Classify routes
  const freeRoutes = routes.filter((r) => parseFloat(r.price_usdc) === 0 && !r.path.includes("restricted"));
  const paidRoutes = routes.filter((r) => parseFloat(r.price_usdc) > 0)
    .sort((a, b) => parseFloat(a.price_usdc) - parseFloat(b.price_usdc));

  info(`Free routes:  ${freeRoutes.length}`);
  info(`Paid routes:  ${paidRoutes.length}`);

  if (paidRoutes.length > 0) {
    const cheapest = paidRoutes[0];
    info(`Cheapest:     ${cheapest.method} ${cheapest.path} ($${cheapest.price_usdc} USDC)`);
  }

  // Pick test targets
  const freeRoute = freeRoutes[0] || null;
  const paidRoute = paidRoutes[0] || null;

  if (!paidRoute && !freeRoute) {
    fail("No testable routes found (all restricted?)");
    process.exit(1);
  }

  // List all routes
  console.log("");
  for (const r of routes) {
    const price = parseFloat(r.price_usdc) === 0 ? "FREE" : `$${r.price_usdc}`;
    info(`  ${r.method.padEnd(6)} ${r.path.padEnd(40)} ${price.padStart(8)}  ${r.tool_id}`);
  }

  /* ── Step 2: Direct health check (free endpoint) ───────────────── */
  if (!skipDirect && freeRoute) {
    step(`Direct health \u2014 ${freeRoute.method} ${freeRoute.path}`);
    try {
      const url = `${provider}${freeRoute.path}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      info(`Status: ${res.status}`);
      if (res.ok) {
        const body = await res.text();
        const preview = body.length > 200 ? body.slice(0, 200) + "..." : body;
        pass(`Free endpoint responded OK`);
        info(`Body: ${preview}`);
      } else {
        fail(`Expected 2xx but got ${res.status}`);
      }
    } catch (err: any) {
      fail(`Request failed: ${err.message}`);
    }
  }

  /* ── Step 3: Direct 402 probe (paid endpoint) ──────────────────── */
  if (!skipDirect && paidRoute) {
    step(`Direct 402 probe \u2014 ${paidRoute.method} ${paidRoute.path}`);
    try {
      const url = `${provider}${paidRoute.path}`;
      const res = await fetch(url, {
        method: paidRoute.method,
        signal: AbortSignal.timeout(15000),
      });
      info(`Status: ${res.status}`);

      if (res.status === 402) {
        pass("Got 402 Payment Required \u2014 x402 is active");

        // Show payment requirements from headers
        for (const [k, v] of res.headers.entries()) {
          if (
            k.toLowerCase().includes("payment") ||
            k.toLowerCase().includes("x402") ||
            k.toLowerCase() === "www-authenticate"
          ) {
            const display = v.length > 120 ? v.slice(0, 120) + "..." : v;
            info(`Header ${k}: ${display}`);
          }
        }

        // Try to parse 402 body for payment info
        const body = await res.text();
        try {
          const parsed = JSON.parse(body);
          if (parsed.payTo) info(`payTo:    ${parsed.payTo}`);
          if (parsed.network) info(`network:  ${parsed.network}`);
          if (parsed.maxAmountRequired) info(`price:    ${parsed.maxAmountRequired}`);
          if (parsed.resource) info(`resource: ${parsed.resource}`);
        } catch {
          if (body.length < 300) info(`Body: ${body}`);
        }
      } else if (res.status === 200) {
        fail("Got 200 \u2014 endpoint isn't behind x402 paywall!");
        info("Check that x402 middleware is configured for this route.");
      } else if (res.status === 401) {
        const body = await res.text();
        fail("Got 401 \u2014 provider requires authentication before x402");
        if (body.length < 300) info(`Body: ${body}`);
        info("The provider likely needs an API key. Through the gateway, auth headers are injected automatically.");
      } else {
        fail(`Unexpected status: ${res.status}`);
        const body = await res.text();
        if (body.length < 300) info(`Body: ${body}`);
      }
    } catch (err: any) {
      fail(`Request failed: ${err.message}`);
    }
  }

  /* ── Step 4: Direct x402 payment ───────────────────────────────── */
  if (!skipDirect && paidRoute && !dryRun) {
    step(`Direct x402 payment \u2014 ${paidRoute.method} ${paidRoute.path}`);

    const needed = parseFloat(paidRoute.price_usdc);
    if (usdcBalance < needed) {
      fail(`Insufficient USDC: need $${needed}, have $${usdcBalance}`);
      info(`Fund ${wallet.address} with USDC on ${BASE_NETWORK}`);
      info(`${explorerBase}/address/${wallet.address}`);
    } else {
      try {
        // Configure x402 client with local viem signer
        const signer = toClientEvmSigner(account);
        const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
        const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
        const x402 = new x402Client();
        registerExactEvmScheme(x402, { signer });

        const paymentFetch = wrapFetchWithPayment(fetch, x402);
        info("Sending paid request...");

        const t0 = performance.now();
        const url = `${provider}${paidRoute.path}`;
        const res = await paymentFetch(url, {
          method: paidRoute.method,
          headers: { "content-type": "application/json" },
        });
        const elapsed = Math.round(performance.now() - t0);

        info(`Status: ${res.status} (${elapsed}ms)`);

        if (res.status === 200) {
          pass("Payment accepted!");
          const body = await res.text();
          const preview = body.length > 300 ? body.slice(0, 300) + "..." : body;
          info(`Response: ${preview}`);

          // Decode receipt
          const receiptHeader = res.headers.get("x-receipt");
          if (receiptHeader) {
            const receipt = JSON.parse(
              Buffer.from(receiptHeader, "base64").toString(),
            );
            pass("Receipt received");
            info(`request_id:      ${receipt.request_id}`);
            info(`tool_id:         ${receipt.tool_id}`);
            info(`outcome:         ${receipt.outcome}`);
            info(`price_usdc:      ${receipt.price_usdc}`);
            info(`payment_tx_hash: ${receipt.payment_tx_hash}`);
            info(`latency_ms:      ${receipt.latency_ms}`);
            if (receipt.payment_tx_hash) {
              info(`Explorer: ${explorerBase}/tx/${receipt.payment_tx_hash}`);
            }
          }
        } else {
          fail(`Payment request returned ${res.status}`);
          const body = await res.text();
          if (body.length < 500) info(`Body: ${body}`);
        }
      } catch (err: any) {
        fail(`Direct payment failed: ${err.message}`);
      }
    }
  }

  /* ── Step 5: Gateway free proxy ────────────────────────────────── */
  const tempToolIds: string[] = [];

  if (!skipGateway && freeRoute) {
    step(`Gateway free proxy \u2014 ${freeRoute.method} ${freeRoute.path}`);

    if (!adminKey) {
      fail("No --admin-key or RT_ADMIN_KEY set \u2014 cannot manage gateway routes");
      info("Skipping gateway tests.");
    } else {
      const tempToolId = `__test_free_${Date.now()}`;
      try {
        // Add temp route to gateway
        const addRes = await fetch(`${gatewayUrl}/admin/routes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminKey}`,
          },
          body: JSON.stringify({
            method: freeRoute.method,
            path: freeRoute.path,
            tool_id: tempToolId,
            price_usdc: "0.00",
            provider: {
              provider_id: freeRoute.provider?.provider_id || "test-provider",
              backend_url: provider,
            },
            _skip_ssrf: true,
          }),
        });

        if (!addRes.ok) {
          const errBody = await addRes.text();
          fail(`Failed to add temp route: ${addRes.status} ${errBody}`);
        } else {
          tempToolIds.push(tempToolId);
          pass(`Temp route added: ${tempToolId}`);

          // Hit through gateway
          const gwRes = await fetch(`${gatewayUrl}${freeRoute.path}`, {
            method: freeRoute.method,
            signal: AbortSignal.timeout(15000),
          });
          info(`Gateway status: ${gwRes.status}`);

          if (gwRes.ok) {
            pass("Free endpoint works through gateway");

            const receiptHeader = gwRes.headers.get("x-receipt");
            if (receiptHeader) {
              const receipt = JSON.parse(
                Buffer.from(receiptHeader, "base64").toString(),
              );
              pass("Receipt attached");
              info(`request_id: ${receipt.request_id}`);
              info(`outcome:    ${receipt.outcome}`);
            }
          } else {
            fail(`Gateway returned ${gwRes.status}`);
            const body = await gwRes.text();
            if (body.length < 500) info(`Body: ${body}`);
          }
        }
      } catch (err: any) {
        fail(`Gateway free proxy test failed: ${err.message}`);
      }
    }
  }

  /* ── Step 6: Gateway paid proxy ────────────────────────────────── */
  if (!skipGateway && paidRoute && !dryRun && adminKey) {
    step(`Gateway paid proxy \u2014 ${paidRoute.method} ${paidRoute.path}`);

    const needed = parseFloat(paidRoute.price_usdc);
    if (usdcBalance < needed) {
      fail(`Insufficient USDC: need $${needed}, have $${usdcBalance}`);
      info(`Fund ${wallet.address} with USDC on ${BASE_NETWORK}`);
    } else {
      const tempToolId = `__test_paid_${Date.now()}`;
      try {
        // Add temp paid route to gateway
        const addRes = await fetch(`${gatewayUrl}/admin/routes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminKey}`,
          },
          body: JSON.stringify({
            method: paidRoute.method,
            path: paidRoute.path,
            tool_id: tempToolId,
            price_usdc: paidRoute.price_usdc,
            provider: {
              provider_id: paidRoute.provider?.provider_id || "test-provider",
              backend_url: provider,
            },
            _skip_ssrf: true,
          }),
        });

        if (!addRes.ok) {
          const errBody = await addRes.text();
          fail(`Failed to add temp route: ${addRes.status} ${errBody}`);
        } else {
          tempToolIds.push(tempToolId);
          pass(`Temp paid route added: ${tempToolId} ($${paidRoute.price_usdc})`);

          // 402 probe through gateway
          const probeRes = await fetch(`${gatewayUrl}${paidRoute.path}`, {
            method: paidRoute.method,
            signal: AbortSignal.timeout(15000),
          });
          info(`Probe status: ${probeRes.status}`);

          if (probeRes.status === 402) {
            pass("Gateway returns 402 \u2014 payment required");
          } else {
            fail(`Expected 402 but got ${probeRes.status}`);
          }

          // Pay through gateway with local viem signer
          const signer = toClientEvmSigner(account);
          const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
          const { registerExactEvmScheme } = await import("@x402/evm/exact/client");
          const x402 = new x402Client();
          registerExactEvmScheme(x402, { signer });

          const paymentFetch = wrapFetchWithPayment(fetch, x402);
          info("Sending paid request through gateway...");

          const t0 = performance.now();
          const gwPaidRes = await paymentFetch(`${gatewayUrl}${paidRoute.path}`, {
            method: paidRoute.method,
            headers: { "content-type": "application/json" },
          });
          const elapsed = Math.round(performance.now() - t0);

          info(`Status: ${gwPaidRes.status} (${elapsed}ms)`);

          if (gwPaidRes.status === 200) {
            pass("Payment accepted through gateway!");
            const body = await gwPaidRes.text();
            const preview = body.length > 300 ? body.slice(0, 300) + "..." : body;
            info(`Response: ${preview}`);

            const receiptHeader = gwPaidRes.headers.get("x-receipt");
            if (receiptHeader) {
              const receipt = JSON.parse(
                Buffer.from(receiptHeader, "base64").toString(),
              );
              pass("Receipt with payment details");
              info(`request_id:      ${receipt.request_id}`);
              info(`tool_id:         ${receipt.tool_id}`);
              info(`outcome:         ${receipt.outcome}`);
              info(`price_usdc:      ${receipt.price_usdc}`);
              info(`payment_tx_hash: ${receipt.payment_tx_hash}`);
              if (receipt.payment_tx_hash) {
                info(`Explorer: ${explorerBase}/tx/${receipt.payment_tx_hash}`);
              }
            }
          } else {
            fail(`Gateway paid request returned ${gwPaidRes.status}`);
            const body = await gwPaidRes.text();
            if (body.length < 500) info(`Body: ${body}`);
          }
        }
      } catch (err: any) {
        fail(`Gateway paid proxy test failed: ${err.message}`);
      }
    }
  }

  /* ── Step 7: Cleanup temp routes ───────────────────────────────── */
  if (tempToolIds.length > 0) {
    step("Cleanup temp routes");
    for (const toolId of tempToolIds) {
      try {
        const res = await fetch(`${gatewayUrl}/admin/routes/${toolId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminKey}` },
        });
        if (res.ok) {
          pass(`Removed ${toolId}`);
        } else {
          fail(`Failed to remove ${toolId}: ${res.status}`);
        }
      } catch (err: any) {
        fail(`Cleanup error for ${toolId}: ${err.message}`);
      }
    }
  }

  /* ── Summary ───────────────────────────────────────────────────── */
  console.log(`\n${DLINE}`);
  console.log("  Test Complete");
  console.log(DLINE);
  info(`Provider: ${provider}`);
  info(`Wallet:   ${wallet.address}`);
  if (dryRun) info("(dry run \u2014 no payments were made)");
  console.log("");
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
