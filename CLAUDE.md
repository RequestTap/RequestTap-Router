# RequestTap Router

Pay-per-request API gateway. Agents pay USDC (via x402) to call provider APIs through the gateway.

## Project Layout

```
packages/shared/    - Types, schemas, constants (composite TS project)
packages/gateway/   - Express HTTP gateway with middleware pipeline
packages/sdk/       - Agent client SDK (RequestTapClient)
examples/agent-demo/- Demo agent script
dashboard/          - Admin dashboard (plain Express + static HTML)
contracts/          - SKALE BITE Solidity (NOT a workspace)
```

- npm workspaces monorepo (`packages/*`, `examples/*`, `dashboard`)
- ESM (`"type": "module"`) throughout
- TypeScript with NodeNext module resolution

## Starting the Router

"Start the router" means: build, ensure `.env` and `routes.json` exist, start the gateway + dashboard, and print the URLs.

### 1. Build all workspaces

```
npm run build
```

### 2. Ensure `.env` exists at the repo root

Copy from `.env.example` if missing. Required vars:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `RT_PAY_TO_ADDRESS` | **yes** | — | Ethereum address to receive payments |
| `RT_PORT` | no | `4402` | Gateway listen port |
| `RT_FACILITATOR_URL` | no | `https://facilitator.cdp.coinbase.com/` | x402 facilitator |
| `RT_BASE_NETWORK` | no | `base-sepolia` | Base network name |
| `RT_ROUTES_FILE` | no | — | Path to routes JSON file |
| `RT_GATEWAY_DOMAIN` | no | — | Gateway domain for IntentMandate merchant matching (falls back to Host header) |
| `RT_ADMIN_KEY` | no | — | Bearer token for admin endpoints |
| `ERC8004_RPC_URL` | no | — | ERC-8004 reputation registry RPC URL |
| `ERC8004_CONTRACT` | no | — | ERC-8004 contract address |
| `ERC8004_MIN_SCORE` | no | `20` | Min reputation score to allow requests |
| `SKALE_RPC_URL` | no | — | Enables SKALE BITE if set |
| `SKALE_CHAIN_ID` | no | — | SKALE chain ID |
| `SKALE_BITE_CONTRACT` | no | — | BITE contract address |
| `SKALE_PRIVATE_KEY` | no | — | SKALE signing key |

For local dev with demo credentials, generate a `.env` with a placeholder pay-to address:

```
RT_PAY_TO_ADDRESS=0x0000000000000000000000000000000000000001
RT_ADMIN_KEY=rt-admin-dev-key
RT_PORT=4402
RT_ROUTES_FILE=routes.json
```

### 3. Ensure `routes.json` exists at the repo root

Copy from the example if missing:

```
cp packages/gateway/routes.example.json routes.json
```

### 4. Start the gateway (port 4402)

```
node --env-file=.env packages/gateway/dist/index.js
```

### 5. Start the dashboard (port 3000)

```
node dashboard/server.js
```

The dashboard reads `GATEWAY_URL` (default `http://localhost:4402`) and `RT_ADMIN_KEY` from the environment.

### 6. Print connection URLs

```
Gateway:   http://localhost:4402
Dashboard: http://localhost:3000/dashboard
Docs:      http://localhost:3000/docs
```

## Running Tests

```
npm test
```

Individual workspace: `npm test --workspace=packages/gateway`

Windows note: test scripts use `npx` (not `node_modules/.bin/`) because bash shims don't work on Windows.

## Common Patterns

- Gateway loads routes from `RT_ROUTES_FILE` env var at startup (see `routes-loader.ts`)
- Admin API is behind Bearer token auth (`RT_ADMIN_KEY`)
- Dashboard proxies admin calls through `/gateway/*` (injects admin key from env) and API test calls through `/api-test/*` (pass-through, no key injection)
- `packages/shared` must have `"composite": true` in tsconfig because other workspaces reference it
- Root `package.json` uses `--if-present` for build/test scripts since not all workspaces have both
- Use `node --env-file=.env` (Node 20+) to load environment — no dotenv dependency

## Claude Code Commands

Slash commands are defined in `.claude/commands/` and available in any Claude Code session:

| Command | Description |
|---|---|
| `/start` | Build + generate demo `.env` + start gateway & dashboard, print URLs |
| `/stop` | Kill gateway (4402) and dashboard (3000) processes |
| `/restart` | Stop, rebuild, and start everything fresh |
| `/status` | Check which services are running and show uptime/route stats |
| `/build` | Build all workspaces (or a specific one, e.g. `/build gateway`) |
| `/run-tests` | Run full test suite (or specific workspace, e.g. `/run-tests gateway`) |
| `/run-debug` | Start gateway with `--inspect` + verbose logging for debugger attachment |
| `/health` | Hit admin health/routes/receipts endpoints and summarize |
| `/add-route` | Add a route via admin API (running) or edit `routes.json` (stopped) |
| `/logs` | Show recent gateway and dashboard log output |

## Key Libraries

- **viem** — Ethereum signing/verification. Use `verifyMessage` (not `recoverAddress`) for EIP-191 personal signatures. `keccak256` expects hex strings, so use `toHex(data)` for Uint8Array input.
- **x402** — Payment protocol middleware (`@x402/express`)
- **SKALE BITE** — Blockchain Integrated Threshold Encryption. SKALE V4 consensus-layer feature that encrypts transactions before consensus and decrypts after finality. Uses `@skalenetwork/bite` package (`BITE.encryptTransaction()`). Available on SKALE V4 chains that advertise encrypted transactions (e.g., SKALE on Base). FAIR chain is purpose-built for BITE/MEV resistance. Our `bite.ts` pattern: encrypt calldata → send encrypted tx → `markPaid` triggers reveal → read decrypted. Contract ABI: `storeIntent(intentId, blob)`, `markPaid(intentId)`, `getIntent(intentId)`. Admin endpoints: `POST /admin/skale/test-anchor`, `GET /admin/skale/intent/:id`, `POST /admin/skale/reveal/:id`. SKALE Base Sepolia official RPC: `https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha` (chain ID `324705682`).
- **ERC-8004** — On-chain agent reputation registry. Uses `getSummary(agentId, [], "", "")` to query scores. Agents pass their token ID via `x-agent-id` header. Contracts: Base Sepolia `0x8004B663056A597Dffe9eCcC1965A193B7388713`, Mainnet `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`.
