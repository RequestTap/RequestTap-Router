import type { GatewayConfig } from "./config.js";
import { logger } from "./utils/logger.js";

export interface BiteService {
  encryptIntent(intentId: string, data: Uint8Array): Promise<string>;
  triggerReveal(intentId: string): Promise<void>;
  getDecryptedIntent(intentId: string): Promise<Uint8Array | null>;
}

export function createBiteService(config: GatewayConfig): BiteService | null {
  if (!config.skaleRpcUrl || !config.skaleBiteContract) {
    logger.info("SKALE BITE not configured, encryption disabled");
    return null;
  }

  // In production, this would connect to SKALE via @skalenetwork/bite.
  // Flow:
  //   1. encryptIntent() - encrypt premium intent on SKALE
  //   2. Base payment succeeds
  //   3. triggerReveal() - calls markPaid() on BiteIntentStore
  //   4. Next SKALE block -> onDecrypt callback fires
  //   5. getDecryptedIntent() retrieves the decrypted data
  logger.info("SKALE BITE service initialized", {
    rpcUrl: config.skaleRpcUrl,
    contract: config.skaleBiteContract,
  });

  return {
    async encryptIntent(intentId: string, data: Uint8Array): Promise<string> {
      logger.debug("Encrypting intent", { intentId, size: data.length });
      // @skalenetwork/bite would handle actual encryption here
      return `bite://${intentId}`;
    },

    async triggerReveal(intentId: string): Promise<void> {
      logger.debug("Triggering BITE reveal", { intentId });
      // Would call markPaid() on the BiteIntentStore contract
    },

    async getDecryptedIntent(intentId: string): Promise<Uint8Array | null> {
      logger.debug("Getting decrypted intent", { intentId });
      // Would retrieve from SKALE after decryption
      return null;
    },
  };
}
