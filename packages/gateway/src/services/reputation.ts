import { createPublicClient, http } from "viem";
import type { GatewayConfig } from "../config.js";
import { logger } from "../utils/logger.js";

export interface ReputationResult {
  score: number;
  count: number;
  allowed: boolean;
}

export interface ReputationService {
  checkReputation(agentId: bigint): Promise<ReputationResult>;
}

const getSummaryAbi = [
  {
    name: "getSummary",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint256" },
      { name: "summaryValue", type: "int256" },
      { name: "summaryValueDecimals", type: "uint256" },
    ],
  },
] as const;

interface CacheEntry {
  result: ReputationResult;
  expiry: number;
}

const CACHE_TTL_MS = 60_000;

export function createReputationService(config: GatewayConfig): ReputationService | null {
  if (!config.erc8004RpcUrl || !config.erc8004Contract) {
    logger.info("ERC-8004 not configured, reputation checking disabled");
    return null;
  }

  const contractAddress = config.erc8004Contract as `0x${string}`;
  const minScore = config.erc8004MinScore ?? 20;
  const clientAddresses = [config.payToAddress as `0x${string}`];

  const client = createPublicClient({
    transport: http(config.erc8004RpcUrl),
  });

  const cache = new Map<string, CacheEntry>();

  logger.info("ERC-8004 reputation service initialized", {
    rpcUrl: config.erc8004RpcUrl,
    contract: contractAddress,
    minScore,
  });

  return {
    async checkReputation(agentId: bigint): Promise<ReputationResult> {
      const cacheKey = agentId.toString();
      const now = Date.now();
      const cached = cache.get(cacheKey);
      if (cached && cached.expiry > now) {
        return cached.result;
      }

      const [count, summaryValue, summaryValueDecimals] = await client.readContract({
        address: contractAddress,
        abi: getSummaryAbi,
        functionName: "getSummary",
        args: [agentId, clientAddresses, "", ""],
      });

      const divisor = 10 ** Number(summaryValueDecimals);
      const score = Number(summaryValue) / divisor;
      const feedbackCount = Number(count);
      const allowed = feedbackCount === 0 || score >= minScore;

      const result: ReputationResult = { score, count: feedbackCount, allowed };
      cache.set(cacheKey, { result, expiry: now + CACHE_TTL_MS });

      return result;
    },
  };
}
