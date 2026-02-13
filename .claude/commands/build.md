---
name: build
description: Build all TypeScript workspaces (or a specific one)
allowed-tools: Bash
---

Build the RequestTap TypeScript workspaces.

If `$ARGUMENTS` is provided, treat it as a workspace name:
- `gateway` -> `npm run build --workspace=packages/gateway`
- `sdk` -> `npm run build --workspace=packages/sdk`
- `shared` -> `npm run build --workspace=packages/shared`
- `all` or empty -> `npm run build` (builds everything)

## Build all

```
npm run build
```

## Build specific workspace

```
npm run build --workspace=packages/<name>
```

Report success or any TypeScript errors encountered.
