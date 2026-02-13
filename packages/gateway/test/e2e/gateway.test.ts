/**
 * E2E tests for the full gateway pipeline.
 *
 * Uses jest.unstable_mockModule to stub SSRF + x402-probe checks so that
 * a local Express upstream on 127.0.0.1 can be used as a backend.
 * All gateway imports happen *after* the mocks are registered.
 */
import { jest } from "@jest/globals";
import express from "express";
import type { Server } from "http";
import request from "supertest";

// Must come before any gateway imports
jest.unstable_mockModule("../../src/utils/ssrf.js", () => ({
  assertNotSSRF: jest.fn(),
  isPrivateOrReserved: jest.fn(() => false),
  SSRFError: class SSRFError extends Error {},
}));

jest.unstable_mockModule("../../src/utils/x402-probe.js", () => ({
  assertNotX402Upstream: jest.fn(),
  X402UpstreamError: class X402UpstreamError extends Error {},
}));

// Dynamic import after mock registration
const { createApp } = await import("../../src/server.js");

// Set admin key
process.env.RT_ADMIN_KEY = "test-key";
delete process.env.RT_ROUTES_FILE;

const AUTH = "Bearer test-key";

const config = {
  port: 0,
  facilitatorUrl: "https://facilitator.example.com",
  payToAddress: "0xTestAddress000000000000000000000000000001",
  baseNetwork: "base-sepolia",
  replayTtlMs: 5000,
};

/* ---------- local upstream server ---------- */

let upstreamServer: Server;
let upstreamPort: number;

beforeAll(async () => {
  const upstream = express();
  upstream.use(express.json());
  upstream.all("*", (req, res) => {
    res.json({ echo: true, path: req.path, method: req.method });
  });

  await new Promise<void>((resolve) => {
    upstreamServer = upstream.listen(0, () => {
      const addr = upstreamServer.address();
      upstreamPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    upstreamServer.close((err) => (err ? reject(err) : resolve()));
  });
});

/* ---------- E2E pipeline ---------- */

describe("e2e: full request pipeline", () => {
  let app: ReturnType<typeof createApp>["app"];
  let replayStore: ReturnType<typeof createApp>["replayStore"];
  let capturedReceipt: any;

  beforeAll(() => {
    const created = createApp({ config, routes: [] });
    app = created.app;
    replayStore = created.replayStore;
  });

  afterAll(() => {
    replayStore.destroy();
  });

  test("add a $0 route via admin API", async () => {
    const res = await request(app)
      .post("/admin/routes")
      .set("Authorization", AUTH)
      .send({
        method: "GET",
        path: "/api/v1/e2e-test",
        tool_id: "e2e-test",
        price_usdc: "0.00",
        provider: {
          provider_id: "local-upstream",
          backend_url: `http://127.0.0.1:${upstreamPort}`,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    // Verify route shows up in listing
    const list = await request(app)
      .get("/admin/routes")
      .set("Authorization", AUTH);
    const found = list.body.routes.find((r: any) => r.tool_id === "e2e-test");
    expect(found).toBeDefined();
  });

  test("GET /api/v1/e2e-test proxies to upstream and returns receipt", async () => {
    const res = await request(app).get("/api/v1/e2e-test");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ echo: true, path: "/api/v1/e2e-test", method: "GET" });

    // Receipt header should be present
    const receiptHeader = res.headers["x-receipt"];
    expect(receiptHeader).toBeDefined();

    // Decode receipt
    capturedReceipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString());
    expect(capturedReceipt.outcome).toBe("SUCCESS");
    expect(capturedReceipt.tool_id).toBe("e2e-test");
  });

  test("receipt appears in admin receipts with outcome SUCCESS", async () => {
    const res = await request(app)
      .get("/admin/receipts?tool_id=e2e-test")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.receipts.length).toBeGreaterThanOrEqual(1);
    const match = res.body.receipts.find(
      (r: any) => r.tool_id === "e2e-test" && r.outcome === "SUCCESS",
    );
    expect(match).toBeDefined();
  });

  test("response_hash is a valid keccak256 hex string", () => {
    expect(capturedReceipt).toBeDefined();
    expect(capturedReceipt.response_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("clean up: delete e2e-test route", async () => {
    const res = await request(app)
      .delete("/admin/routes/e2e-test")
      .set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify gone
    const list = await request(app)
      .get("/admin/routes")
      .set("Authorization", AUTH);
    const found = list.body.routes.find((r: any) => r.tool_id === "e2e-test");
    expect(found).toBeUndefined();
  });
});

/* ---------- Payment challenge (402) ---------- */

describe("e2e: payment challenge", () => {
  test("$0.01 route is configured for x402 payment", async () => {
    // Create app with a paid route. Without a real x402 facilitator the
    // payment middleware gracefully degrades (logs a warning and calls
    // next()), so we can't get a real 402 in tests. Instead we verify:
    //   1. The route is correctly registered with the paid price
    //   2. The request still completes (graceful degradation)
    //   3. The receipt records the correct price
    const paidRoute = {
      method: "GET",
      path: "/api/v1/paid-test",
      tool_id: "paid-test",
      price_usdc: "0.01",
      provider: {
        provider_id: "local-upstream",
        backend_url: `http://127.0.0.1:${upstreamPort}`,
      },
    };
    const { app, replayStore } = createApp({ config, routes: [paidRoute] });

    // Verify route is listed with correct price
    const routeList = await request(app)
      .get("/admin/routes")
      .set("Authorization", AUTH);
    const route = routeList.body.routes.find((r: any) => r.tool_id === "paid-test");
    expect(route).toBeDefined();
    expect(route.price_usdc).toBe("0.01");

    // Without a facilitator, x402 degrades gracefully → request succeeds
    const res = await request(app).get("/api/v1/paid-test");
    expect(res.status).toBe(200);

    // Receipt should record the configured price
    const receiptHeader = res.headers["x-receipt"];
    expect(receiptHeader).toBeDefined();
    const receipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString());
    expect(receipt.price_usdc).toBe("0.01");
    expect(receipt.outcome).toBe("SUCCESS");

    replayStore.destroy();
  });
});

/* ---------- SKALE anchor ---------- */

describe("e2e: SKALE anchor", () => {
  test("POST /admin/skale/test-anchor returns 400 when SKALE not configured", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });

    const res = await request(app)
      .post("/admin/skale/test-anchor")
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("SKALE not configured");

    replayStore.destroy();
  });
});
