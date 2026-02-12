<p align="center">
  <img src="media/request-tap-logo-transparent.png" alt="RequestTap Router" width="700" />
</p>

# RequestTap Router

Open Source x402 API Router. Instantly turn any API into a USDC pay-per-request Service for AI Agents.

## Key Features

- **x402 Payments** - Native HTTP 402 payment flow on Base (USDC)
- **AP2 Mandates** - Spend caps, tool allowlists, expiry, signature verification
- **Replay Protection** - Idempotency key + request hash deduplication
- **SSRF Protection** - Blocks private/reserved IP ranges at route compile time
- **BITE Encryption** - Optional SKALE BITE for encrypted premium intents
- **Receipts** - Structured JSON receipts for every request (SUCCESS, DENIED, ERROR)

## Architecture

```
AI Agent  ──>  Agent SDK  ──>  Gateway  ──>  Upstream API
                  │              │
                  │         ┌────┴─────────┐
                  │         │   Pipeline   │
                  │         ├──────────────┤
                  │         │ Route Match  │ ← OpenAPI 3.0
                  │         │ Idempotency  │
                  │         │ AP2 Mandate  │ ← EIP-191 Signatures
                  │         │ x402 Payment │ ← Base L2 / USDC
                  │         │ BITE Encrypt │ ← SKALE Network
                  │         │ Proxy        │
                  │         │ Receipt      │
                  │         └──────────────┘
                  │
                  └── Receipts (SUCCESS / DENIED / ERROR)

Payments: x402 Protocol → Coinbase CDP → Base L2 (USDC)
Encryption: SKALE BITE → Calypso Hub → Threshold Encryption
Signing: viem → EIP-191 Personal Sign → EIP-155 Chain IDs
Contracts: Solidity → Hardhat → SKALE Deployment
```

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `packages/shared` | Types, schemas, constants |
| `packages/gateway` | Express HTTP gateway with middleware pipeline |
| `packages/sdk` | Agent client SDK (`RequestTapClient`) |
| `dashboard` | Admin dashboard & debug tools |
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

## Website

[RequestTap.ai](https://RequestTap.ai)

## Contact

[support@requesttap.ai](mailto:support@requesttap.ai)

## License

MIT
