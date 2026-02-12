# BITE Intent Store

SKALE BITE (Block-level Invisible Transaction Encryption) contract for RequestTap Router.

## What is private

Intent data (tool ID, request payload, parameters) is encrypted before payment occurs. This prevents MEV extraction and front-running of premium API requests. The encrypted blob is stored on SKALE via the `BiteIntentStore` contract.

## What triggers unlock

1. Agent submits encrypted intent to SKALE via `storeIntent()`
2. Base payment settles (USDC transfer confirmed via x402 facilitator)
3. Owner calls `markPaid()` on the SKALE contract
4. SKALE BITE protocol detects the paid flag and triggers conditional decryption on the next block
5. `onDecrypt()` callback fires with the plaintext, storing the revealed data

## Failure handling

- If payment fails on Base, the encrypted blob stays encrypted indefinitely
- No funds are lost since payment and decryption are separate steps
- A configurable expiry can be added to auto-cleanup stale intents
- The owner can retry the payment flow without re-encrypting

## Dependencies

- `@skalenetwork/bite-solidity` - BITE protocol interfaces
- Solidity ^0.8.20

## Compilation

```bash
npx hardhat compile
# or
solc --optimize --bin --abi contracts/BiteIntentStore.sol
```
