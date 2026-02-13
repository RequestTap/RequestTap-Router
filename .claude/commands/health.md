---
name: health
description: Quick health check — hit the gateway admin endpoints and report status
allowed-tools: Bash
---

Run a quick health check against the running gateway.

## 1. Health endpoint

```bash
curl -s http://localhost:4402/admin/health -H "Authorization: Bearer rt-admin-dev-key"
```

## 2. Routes endpoint

```bash
curl -s http://localhost:4402/admin/routes -H "Authorization: Bearer rt-admin-dev-key"
```

## 3. Receipt stats

```bash
curl -s http://localhost:4402/admin/receipts/stats -H "Authorization: Bearer rt-admin-dev-key"
```

## 4. Report

Summarize in a clean table:

```
Health:     OK (uptime: Xm Ys)
Routes:     N registered
Receipts:   N total (X success, Y errors)
Revenue:    $Z.ZZ USDC
Avg Latency: Nms
```

If the gateway is not running, say so and suggest `/start`.
