import { Router } from "express";
import { writeFileSync } from "fs";
import { createAdminAuth } from "./middleware/admin-auth.js";
import type { RouteManager } from "./server.js";
import type { ReceiptStore } from "./services/receipt-store.js";
import type { SpendTracker } from "./ap2.js";
import type { GatewayConfig } from "./config.js";
import type { ConfigStore } from "./services/config-store.js";
import { parseOpenApiToRoutes } from "./services/openapi-parser.js";
import { generateAgentApiDocs } from "./services/docs-generator.js";

export interface AdminRouterDeps {
  routeManager: RouteManager;
  receiptStore: ReceiptStore;
  spendTracker: SpendTracker;
  config: GatewayConfig;
  configStore: ConfigStore;
  startTime: number;
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const { routeManager, receiptStore, spendTracker, config, configStore, startTime } = deps;
  const router = Router();

  router.use(createAdminAuth());

  // GET /admin/health
  router.get("/health", (_req, res) => {
    const uptimeMs = Date.now() - startTime;
    const routes = routeManager.getRoutes();
    const receipts = receiptStore.query();
    res.json({
      status: "ok",
      uptime_ms: uptimeMs,
      uptime_human: formatUptime(uptimeMs),
      route_count: routes.length,
      receipt_count: receipts.length,
    });
  });

  // GET /admin/config
  router.get("/config", (_req, res) => {
    res.json({
      port: config.port,
      baseNetwork: config.baseNetwork,
      facilitatorUrl: config.facilitatorUrl,
      replayTtlMs: config.replayTtlMs,
      payToAddress: config.payToAddress ? mask(config.payToAddress, 6, 4) : null,
      routesFile: process.env.RT_ROUTES_FILE || null,
    });
  });

  // GET /admin/routes
  router.get("/routes", (_req, res) => {
    const routes = routeManager.getRoutes().map((r) => ({
      method: r.method,
      path: r.path,
      tool_id: r.tool_id,
      price_usdc: r.price_usdc,
      group: r.group || null,
      description: r.description || null,
      provider: {
        provider_id: r.provider.provider_id,
        backend_url: r.provider.backend_url,
        auth: r.provider.auth
          ? { header: r.provider.auth.header, value: "***" }
          : undefined,
      },
    }));
    res.json({ routes });
  });

  // POST /admin/routes
  router.post("/routes", (req, res) => {
    const { method, path, tool_id, price_usdc, provider } = req.body;

    // Validate required fields
    if (!method || typeof method !== "string") {
      res.status(400).json({ error: "method is required (string)" });
      return;
    }
    if (!path || typeof path !== "string" || !path.startsWith("/")) {
      res.status(400).json({ error: "path is required (string starting with /)" });
      return;
    }
    if (!tool_id || typeof tool_id !== "string") {
      res.status(400).json({ error: "tool_id is required (string)" });
      return;
    }
    if (!price_usdc || typeof price_usdc !== "string" || isNaN(parseFloat(price_usdc))) {
      res.status(400).json({ error: "price_usdc is required (decimal string)" });
      return;
    }
    if (!provider || typeof provider !== "object") {
      res.status(400).json({ error: "provider is required (object)" });
      return;
    }
    if (!provider.provider_id || !provider.backend_url) {
      res.status(400).json({ error: "provider.provider_id and provider.backend_url are required" });
      return;
    }

    const rule = {
      method: method.toUpperCase(),
      path,
      tool_id,
      price_usdc,
      provider: {
        provider_id: provider.provider_id,
        backend_url: provider.backend_url,
        ...(provider.auth ? { auth: { header: provider.auth.header, value: provider.auth.value } } : {}),
      },
    };

    try {
      routeManager.addRoute(rule);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    // Persist to file if RT_ROUTES_FILE is set
    const routesFile = process.env.RT_ROUTES_FILE;
    if (routesFile) {
      try {
        writeFileSync(routesFile, JSON.stringify({ routes: routeManager.getRoutes() }, null, 2));
      } catch {
        // Non-fatal: route was added in-memory
      }
    }

    res.status(201).json({ ok: true, route: rule });
  });

  // DELETE /admin/routes/:toolId
  router.delete("/routes/:toolId", (req, res) => {
    const removed = routeManager.removeRoute(req.params.toolId);
    if (!removed) {
      res.status(404).json({ error: `Route with tool_id "${req.params.toolId}" not found` });
      return;
    }

    // Persist to file if RT_ROUTES_FILE is set
    const routesFile = process.env.RT_ROUTES_FILE;
    if (routesFile) {
      try {
        writeFileSync(routesFile, JSON.stringify({ routes: routeManager.getRoutes() }, null, 2));
      } catch {
        // Non-fatal
      }
    }

    res.json({ ok: true, tool_id: req.params.toolId });
  });

  // GET /admin/receipts
  router.get("/receipts", (req, res) => {
    const filter: { tool_id?: string; outcome?: string } = {};
    if (req.query.tool_id) filter.tool_id = String(req.query.tool_id);
    if (req.query.outcome) filter.outcome = String(req.query.outcome);

    let receipts = receiptStore.query(filter);

    // Sort newest first
    receipts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;
    const limit = parseInt(String(req.query.limit || "50"), 10) || 50;
    const total = receipts.length;
    receipts = receipts.slice(offset, offset + limit);

    res.json({ receipts, total, offset, limit });
  });

  // GET /admin/receipts/stats
  router.get("/receipts/stats", (_req, res) => {
    const all = receiptStore.query();
    const total = all.length;
    const success = all.filter((r) => r.outcome === "SUCCESS").length;
    const error = all.filter((r) => r.outcome === "ERROR").length;
    const denied = all.filter((r) => r.outcome === "DENIED").length;
    const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : "0.0";
    const totalUsdc = all.reduce((sum, r) => sum + parseFloat(r.price_usdc || "0"), 0).toFixed(6);
    const latencies = all.filter((r) => r.latency_ms != null).map((r) => r.latency_ms!);
    const avgLatency = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    res.json({
      total_requests: total,
      success_count: success,
      error_count: error,
      denied_count: denied,
      success_rate: successRate,
      total_usdc_spent: totalUsdc,
      avg_latency_ms: avgLatency,
    });
  });

  // GET /admin/spend/:mandateId
  router.get("/spend/:mandateId", (req, res) => {
    const spent = spendTracker.getSpent(req.params.mandateId);
    res.json({
      mandate_id: req.params.mandateId,
      spent_today_usdc: spent.toFixed(6),
      date: new Date().toISOString().slice(0, 10),
    });
  });

  // GET /admin/dashboard-config
  router.get("/dashboard-config", (_req, res) => {
    const dashConfig = configStore.load();
    res.json(dashConfig);
  });

  // PUT /admin/dashboard-config
  router.put("/dashboard-config", (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Request body must be an object" });
      return;
    }

    const current = configStore.load();
    const updated = { ...current, ...body };

    // Apply payToAddress to live config if provided
    if (typeof updated.payToAddress === "string" && updated.payToAddress) {
      (config as any).payToAddress = updated.payToAddress;
    }
    // Apply baseNetwork to live config if provided
    if (typeof updated.baseNetwork === "string" && updated.baseNetwork) {
      (config as any).baseNetwork = updated.baseNetwork;
    }

    try {
      configStore.save(updated);
    } catch (err: any) {
      res.status(500).json({ error: `Failed to save config: ${err.message}` });
      return;
    }

    res.json({ ok: true, config: updated });
  });

  // PUT /admin/routes/:toolId
  router.put("/routes/:toolId", (req, res) => {
    const { toolId } = req.params;
    const routes = routeManager.getRoutes();
    const idx = routes.findIndex((r) => r.tool_id === toolId);
    if (idx === -1) {
      res.status(404).json({ error: `Route with tool_id "${toolId}" not found` });
      return;
    }

    const existing = routes[idx];
    const body = req.body;

    // Update allowed fields
    if (typeof body.price_usdc === "string") existing.price_usdc = body.price_usdc;
    if (typeof body.group === "string" || body.group === null) existing.group = body.group || undefined;
    if (typeof body.description === "string") existing.description = body.description;
    if (body.provider && typeof body.provider === "object") {
      if (body.provider.backend_url) existing.provider.backend_url = body.provider.backend_url;
      if (body.provider.provider_id) existing.provider.provider_id = body.provider.provider_id;
      if (body.provider.auth) {
        existing.provider.auth = { header: body.provider.auth.header, value: body.provider.auth.value };
      }
    }

    // Recompile routes
    routeManager.removeRoute(toolId);
    routeManager.addRoute(existing);

    // Persist
    persistRoutes(routeManager);

    res.json({ ok: true, route: existing });
  });

  // POST /admin/routes/import
  router.post("/routes/import", (req, res) => {
    const { openapi, defaults } = req.body;

    if (!openapi || typeof openapi !== "object") {
      res.status(400).json({ error: "openapi spec object is required" });
      return;
    }
    if (!defaults || typeof defaults !== "object") {
      res.status(400).json({ error: "defaults object is required" });
      return;
    }
    if (!defaults.providerId || !defaults.backendUrl || !defaults.priceUsdc) {
      res.status(400).json({ error: "defaults must include providerId, backendUrl, priceUsdc" });
      return;
    }

    let imported;
    try {
      imported = parseOpenApiToRoutes(openapi, defaults);
    } catch (err: any) {
      res.status(400).json({ error: `Failed to parse OpenAPI spec: ${err.message}` });
      return;
    }

    const added: string[] = [];
    const skipped: string[] = [];
    for (const rule of imported) {
      try {
        routeManager.addRoute(rule);
        added.push(rule.tool_id);
      } catch {
        skipped.push(rule.tool_id);
      }
    }

    persistRoutes(routeManager);

    res.status(201).json({ ok: true, added_count: added.length, skipped_count: skipped.length, added, skipped });
  });

  // GET /admin/docs/openapi
  router.get("/docs/openapi", (_req, res) => {
    const routes = routeManager.getRoutes();
    const dashConfig = configStore.load();
    const spec = generateAgentApiDocs(routes, dashConfig.routeGroups, {
      title: "RequestTap API",
      description: "AI Agent API powered by RequestTap",
      baseUrl: `http://localhost:${config.port}`,
      payToAddress: dashConfig.payToAddress || config.payToAddress,
    });
    res.json(spec);
  });

  return router;
}

function persistRoutes(routeManager: RouteManager): void {
  const routesFile = process.env.RT_ROUTES_FILE;
  if (routesFile) {
    try {
      writeFileSync(routesFile, JSON.stringify({ routes: routeManager.getRoutes() }, null, 2));
    } catch {
      // Non-fatal
    }
  }
}

function mask(s: string, prefixLen: number, suffixLen: number): string {
  if (s.length <= prefixLen + suffixLen) return s;
  return s.slice(0, prefixLen) + "***" + s.slice(-suffixLen);
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
