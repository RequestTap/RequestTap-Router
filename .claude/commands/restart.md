---
name: restart
description: Stop and restart all RequestTap services (rebuild, then start gateway + dashboard)
allowed-tools: Bash, Read, Write, Glob, Edit
---

Restart the RequestTap Router. This is equivalent to running `/stop` then `/start`.

## 1. Kill existing processes

Find and kill any processes on ports 4402 (gateway) and 3000 (dashboard):

```bash
netstat -ano | findstr :4402
netstat -ano | findstr :3000
```

Kill with `powershell -Command "Stop-Process -Id <PID> -Force"`.

## 2. Rebuild

```
npm run build
```

## 3. Ensure `.env` and `routes.json` exist

- If `.env` missing, create with dev defaults (see `/start` command)
- If `routes.json` missing, copy from `packages/gateway/routes.example.json`

## 4. Start services in background

```bash
node --env-file=.env packages/gateway/dist/index.js   # gateway on :4402
node dashboard/server.js                                # dashboard on :3000
```

## 5. Print connection URLs

```
Gateway:   http://localhost:4402
Dashboard: http://localhost:3000/dashboard
Docs:      http://localhost:3000/docs
```
