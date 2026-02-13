---
name: run-tests
description: Run the full test suite or tests for a specific workspace
allowed-tools: Bash
---

Run the RequestTap test suite.

If `$ARGUMENTS` is provided, treat it as a workspace name or filter:
- `gateway` or `packages/gateway` -> run only gateway tests
- `sdk` or `packages/sdk` -> run only SDK tests
- `shared` or `packages/shared` -> run only shared tests
- Any other value -> pass as jest filter

## Run all tests

```
npm test
```

## Run a specific workspace

```
npm test --workspace=packages/<name>
```

## Windows note

Test scripts use `npx` (not `node_modules/.bin/`) because bash shims don't work on Windows.

## Report results

After tests complete, summarize:
- Total tests run, passed, failed
- If any failures, show the failing test names and a brief description of what went wrong
