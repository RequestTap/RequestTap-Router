---
name: status
description: Check if RequestTap services are running and show their status
allowed-tools: Bash
---

Check the status of all RequestTap Router services.

## 1. Check gateway (port 4402)

```bash
netstat -ano | findstr :4402
```

If listening, try hitting the health endpoint:

```bash
curl -s http://localhost:4402/admin/health -H "Authorization: Bearer rt-admin-dev-key"
```

Report: running/stopped, uptime, route count, receipt count.

## 2. Check dashboard (port 3000)

```bash
netstat -ano | findstr :3000
```

If listening, report as running. If not, report as stopped.

## 3. Print summary

Format like:

```
Service     Status    Port   Details
─────────   ───────   ────   ───────
Gateway     running   4402   uptime: 5m 32s, 3 routes, 0 receipts
Dashboard   running   3000   http://localhost:3000/dashboard
```

Adapt based on what's actually running. If a service is stopped, suggest using `/start` or `/restart`.
