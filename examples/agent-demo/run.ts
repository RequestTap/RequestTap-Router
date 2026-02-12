import { RequestTapClient } from "@requesttap/sdk";
import type { Mandate } from "@requesttap/shared";
import { writeFileSync } from "fs";

const GATEWAY_URL = process.env.RT_GATEWAY_URL || "http://localhost:4402";

async function main() {
  console.log("=== RequestTap Agent Demo ===\n");

  // Create a mandate that only allows the "quote" tool
  const mandate: Mandate = {
    mandate_id: "demo-mandate-001",
    owner_pubkey: "0x0000000000000000000000000000000000000000",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    max_spend_usdc_per_day: "0.50",
    allowlisted_tool_ids: ["quote"],
    signature: "0x", // Would be a real signature in production
  };

  const client = new RequestTapClient({
    gatewayBaseUrl: GATEWAY_URL,
    mandate,
  });

  await client.init();
  console.log("Client initialized\n");

  // --- Call 1: GET /api/v1/quote (SUCCEEDS - in allowlist, under budget) ---
  console.log("--- Call 1: GET /api/v1/quote ---");
  try {
    const res1 = await client.request("GET", "/api/v1/quote");
    console.log(`  Status: ${res1.status}`);
    console.log(`  Outcome: ${res1.receipt?.outcome || "N/A"}`);
    console.log(`  Data: ${JSON.stringify(res1.data)}`);
  } catch (err) {
    console.log(`  Error: ${err}`);
  }
  console.log();

  // --- Call 2: POST /api/v1/premium-brief (DENIED - not in allowlist) ---
  console.log("--- Call 2: POST /api/v1/premium-brief ---");
  try {
    const res2 = await client.request("POST", "/api/v1/premium-brief", {
      body: { topic: "AI market trends" },
    });
    console.log(`  Status: ${res2.status}`);
    console.log(`  Outcome: ${res2.receipt?.outcome || "N/A"}`);
    console.log(`  Reason: ${res2.receipt?.explanation || "N/A"}`);
  } catch (err) {
    console.log(`  Error: ${err}`);
  }
  console.log();

  // --- Summary ---
  console.log("=== Spend Summary ===");
  console.log(`  Total spent: ${client.getTotalSpent()} USDC`);
  console.log(`  Total receipts: ${client.getReceipts().length}`);

  // Dump receipts to file
  const receiptsJson = client.dumpReceipts();
  writeFileSync("receipts.json", receiptsJson);
  console.log(`\n  Receipts written to receipts.json`);
}

main().catch(console.error);
