---
name: add-route
description: Add a new API route to the gateway via the admin API or routes.json
allowed-tools: Bash, Read, Edit
---

Add a new route to the RequestTap gateway.

`$ARGUMENTS` may contain a description of the route to add (e.g., "GET /api/weather at api.weather.com for $0.02").

## 1. Check if gateway is running

```bash
netstat -ano | findstr :4402
```

## 2a. If gateway is running — use the admin API

Parse the user's intent and POST to the admin API:

```bash
curl -s -X POST http://localhost:4402/admin/routes \
  -H "Authorization: Bearer rt-admin-dev-key" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/api/v1/<path>",
    "tool_id": "<tool-id>",
    "price_usdc": "0.01",
    "provider": {
      "provider_id": "<provider>",
      "backend_url": "https://<backend>"
    }
  }'
```

The gateway will auto-persist to `routes.json` if `RT_ROUTES_FILE` is set.

## 2b. If gateway is NOT running — edit routes.json directly

Read `routes.json`, add the new route entry to the `routes` array, and write it back.

## 3. Confirm

Show the user the added route details and the current route count.
