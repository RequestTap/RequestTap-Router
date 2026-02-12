export interface GatewayConfig {
  port: number;
  facilitatorUrl: string;
  payToAddress: string;
  baseNetwork: string;
  replayTtlMs: number;
  skaleRpcUrl?: string;
  skaleChainId?: number;
  skaleBiteContract?: string;
  skalePrivateKey?: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const port = parseInt(env.RT_PORT || "4402", 10);
  const facilitatorUrl = env.RT_FACILITATOR_URL || "https://facilitator.cdp.coinbase.com/";
  const payToAddress = env.RT_PAY_TO_ADDRESS || "";
  const baseNetwork = env.RT_BASE_NETWORK || "base-sepolia";
  const replayTtlMs = parseInt(env.RT_REPLAY_TTL_MS || "300000", 10);

  if (!payToAddress) {
    throw new Error("RT_PAY_TO_ADDRESS is required");
  }

  const config: GatewayConfig = {
    port,
    facilitatorUrl,
    payToAddress,
    baseNetwork,
    replayTtlMs,
  };

  if (env.SKALE_RPC_URL) {
    config.skaleRpcUrl = env.SKALE_RPC_URL;
    config.skaleChainId = env.SKALE_CHAIN_ID ? parseInt(env.SKALE_CHAIN_ID, 10) : undefined;
    config.skaleBiteContract = env.SKALE_BITE_CONTRACT;
    config.skalePrivateKey = env.SKALE_PRIVATE_KEY;
  }

  return config;
}
