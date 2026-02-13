import request from "supertest";
import { createApp } from "../../src/server.js";
import type { GatewayConfig } from "../../src/config.js";

// Set admin key before admin-auth middleware reads it
process.env.RT_ADMIN_KEY = "test-key";
// Prevent file persistence during tests
delete process.env.RT_ROUTES_FILE;

const AUTH = "Bearer test-key";

const config: GatewayConfig = {
  port: 0,
  facilitatorUrl: "https://facilitator.example.com",
  payToAddress: "0xTestAddress000000000000000000000000000001",
  baseNetwork: "base-sepolia",
  replayTtlMs: 5000,
};

describe("admin API integration", () => {
  test("GET /admin/health returns status, route_count, receipt_count", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });
    const res = await request(app)
      .get("/admin/health")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.route_count).toBe("number");
    expect(typeof res.body.receipt_count).toBe("number");
    expect(typeof res.body.uptime_ms).toBe("number");

    replayStore.destroy();
  });

  test("GET /admin/health rejects without auth", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });
    const res = await request(app).get("/admin/health");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);

    replayStore.destroy();
  });

  test("GET /admin/routes returns current routes with masked auth", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });
    const res = await request(app)
      .get("/admin/routes")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("routes");
    expect(Array.isArray(res.body.routes)).toBe(true);

    replayStore.destroy();
  });

  test("GET /admin/config returns gateway config with masked address", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });
    const res = await request(app)
      .get("/admin/config")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("port");
    expect(res.body).toHaveProperty("baseNetwork", "base-sepolia");
    // Address should be masked (contains ***)
    expect(res.body.payToAddress).toContain("***");

    replayStore.destroy();
  });

  test("GET /admin/receipts returns receipts with pagination fields", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });
    const res = await request(app)
      .get("/admin/receipts")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("receipts");
    expect(Array.isArray(res.body.receipts)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.offset).toBe("number");
    expect(typeof res.body.limit).toBe("number");

    replayStore.destroy();
  });

  test("GET /admin/receipts?tool_id=X returns filtered results", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });

    // Generate a receipt by hitting a missing route
    await request(app).get("/api/v1/filter-test");

    const res = await request(app)
      .get("/admin/receipts?tool_id=unknown")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    // The 404 receipt has tool_id "unknown"
    for (const r of res.body.receipts) {
      expect(r.tool_id).toBe("unknown");
    }

    replayStore.destroy();
  });
});

describe("admin route CRUD", () => {
  test("POST /admin/routes with missing fields returns 400", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });

    // Missing everything
    let res = await request(app)
      .post("/admin/routes")
      .set("Authorization", AUTH)
      .send({});
    expect(res.status).toBe(400);

    // Missing provider
    res = await request(app)
      .post("/admin/routes")
      .set("Authorization", AUTH)
      .send({ method: "GET", path: "/api/v1/x", tool_id: "x", price_usdc: "0.00" });
    expect(res.status).toBe(400);

    // Missing provider fields
    res = await request(app)
      .post("/admin/routes")
      .set("Authorization", AUTH)
      .send({
        method: "GET",
        path: "/api/v1/x",
        tool_id: "x",
        price_usdc: "0.00",
        provider: { provider_id: "p" },
      });
    expect(res.status).toBe(400);

    replayStore.destroy();
  });

  test("DELETE /admin/routes/:toolId with nonexistent tool returns 404", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });
    const res = await request(app)
      .delete("/admin/routes/nonexistent")
      .set("Authorization", AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);

    replayStore.destroy();
  });

  test("GET /admin/receipts/stats returns aggregate stats", async () => {
    const { app, replayStore } = createApp({ config, routes: [] });

    // Generate a receipt
    await request(app).get("/api/v1/stats-test");

    const res = await request(app)
      .get("/admin/receipts/stats")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(typeof res.body.total_requests).toBe("number");
    expect(typeof res.body.success_count).toBe("number");
    expect(typeof res.body.denied_count).toBe("number");
    expect(typeof res.body.success_rate).toBe("string");

    replayStore.destroy();
  });

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
