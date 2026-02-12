<p align="center">
  <img src="rerquest-tap-logo-transparent.png" alt="RequestTap Router" width="400" />
</p>

# RequestTap Router

An open-source payment gateway router that sits between AI agents and paid API endpoints. It enforces x402 payments on Base (USDC), verifies AP2 mandates (spend caps & allowlists), prevents replay attacks, and optionally encrypts premium intent data on SKALE via the BITE protocol.

## Architecture

```
Agent SDK  ──>  Gateway  ──>  Upstream API
   │              │
   │         ┌────┴────┐
   │         │ Pipeline │
   │         ├──────────┤
   │         │ Route    │
   │         │ Replay   │
   │         │ Mandate  │
   │         │ Payment  │
   │         │ BITE     │
   │         │ Proxy    │
   │         │ Receipt  │
   │         └──────────┘
   │
   └── Receipts (SUCCESS / DENIED)
```

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `packages/shared` | Types, schemas, constants |
| `packages/gateway` | Express HTTP gateway with middleware pipeline |
| `packages/sdk` | Agent client SDK (`RequestTapClient`) |
| `examples/agent-demo` | Demo script |
| `contracts/` | SKALE BITE Solidity contract |

## Quick Start

```bash
npm install
npm run build --workspaces --if-present

# Run tests
npm test --workspace=packages/gateway

# Start gateway
cp .env.example .env
# Edit .env with your RT_PAY_TO_ADDRESS
npm start --workspace=packages/gateway
```

## Configuration

Set environment variables or create a `.env` file (see `.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `RT_PORT` | Gateway port | `4402` |
| `RT_FACILITATOR_URL` | x402 facilitator URL | Coinbase facilitator |
| `RT_PAY_TO_ADDRESS` | USDC payment destination | **required** |
| `RT_BASE_NETWORK` | Base network | `base-sepolia` |

## Key Features

- **x402 Payments** - Native HTTP 402 payment flow on Base (USDC)
- **AP2 Mandates** - Spend caps, tool allowlists, expiry, signature verification
- **Replay Protection** - Idempotency key + request hash deduplication
- **SSRF Protection** - Blocks private/reserved IP ranges at route compile time
- **BITE Encryption** - Optional SKALE BITE for encrypted premium intents
- **Receipts** - Structured JSON receipts for every request (SUCCESS, DENIED, ERROR)

## License

MIT
