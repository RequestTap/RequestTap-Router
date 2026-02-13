---
name: start
description: Build and start the RequestTap gateway + dashboard locally with demo credentials
allowed-tools: Bash, Read, Write, Glob, Edit
---

Start the RequestTap Router locally. Follow these steps in order:

## 1. Build all workspaces

```
npm run build
```

## 2. Ensure `.env` exists at the repo root

Check if `.env` exists. If not, create one with dev defaults:

```
RT_PAY_TO_ADDRESS=0x0000000000000000000000000000000000000001
RT_ADMIN_KEY=rt-admin-dev-key
RT_PORT=4402
RT_FACILITATOR_URL=https://www.x402.org
RT_BASE_NETWORK=base-sepolia
RT_ROUTES_FILE=routes.json
```

## 3. Ensure `routes.json` exists at the repo root

If missing, copy the example:

```
cp packages/gateway/routes.example.json routes.json
```

## 4. Kill any existing processes on ports 4402 and 3000

Use `netstat -ano | findstr :PORT` to find PIDs, then `powershell -Command "Stop-Process -Id PID -Force"` to kill them.

## 5. Start the gateway (background)

```
node --env-file=.env packages/gateway/dist/index.js
```

Run in background. Wait a few seconds and confirm it started by checking output for "listening on port".

## 6. Start the dashboard (background)

```
node dashboard/server.js
```

Run in background.

## 7. Print connection URLs

Print these to the user:

```
Gateway:   http://localhost:4402
Dashboard: http://localhost:3000/dashboard
Docs:      http://localhost:3000/docs
Admin API: http://localhost:4402/admin/health
```
