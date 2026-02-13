---
name: run-debug
description: Start the gateway in debug mode with verbose logging and inspect
allowed-tools: Bash, Read, Write, Glob, Edit
---

Start the RequestTap gateway in debug mode with enhanced logging.

## 1. Ensure prerequisites

Same as `/start` — make sure `.env` and `routes.json` exist, build if needed.

## 2. Kill any existing gateway on port 4402

```bash
netstat -ano | findstr :4402
```

Kill if found.

## 3. Start with Node inspect and DEBUG logging

```bash
NODE_DEBUG=http,net node --inspect --env-file=.env packages/gateway/dist/index.js
```

Run in background. This enables:
- Node.js inspector on `ws://127.0.0.1:9229` (attach Chrome DevTools or VS Code debugger)
- Verbose HTTP/net debug output from Node internals
- All gateway JSON log lines (info, debug, warn, error levels)

## 4. Optionally start dashboard too

```bash
node dashboard/server.js
```

## 5. Print connection info

```
Gateway (debug):  http://localhost:4402
Inspector:        chrome://inspect (or ws://127.0.0.1:9229)
Dashboard:        http://localhost:3000/dashboard
```

Remind the user they can attach a debugger via Chrome DevTools or VS Code.
