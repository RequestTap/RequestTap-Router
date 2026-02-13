import { v4 as uuidv4 } from "uuid";
import { HEADERS, type AnyMandate, type Receipt, Outcome } from "@requesttap/shared";

export interface RequestTapClientOptions {
  gatewayBaseUrl: string;
  mandate?: AnyMandate;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  idempotencyKey?: string;
}

export interface CdpWalletConfig {
  apiKeyId?: string;
  apiKeySecret?: string;
  walletSecret?: string;
  network?: string;
}

export class RequestTapClient {
  private baseUrl: string;
  private mandate?: AnyMandate;
  private receipts: Receipt[] = [];
  private paymentFetch: typeof fetch = fetch;
  private walletAddress: string | null = null;

  constructor(options: RequestTapClientOptions) {
    this.baseUrl = options.gatewayBaseUrl.replace(/\/$/, "");
    this.mandate = options.mandate;
  }

  async init(cdpConfig?: CdpWalletConfig): Promise<void> {
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
    const { registerExactEvmScheme } = await import("@x402/evm/exact/client");

    // Create CDP client - reads CDP_API_KEY_ID, CDP_API_KEY_SECRET,
    // CDP_WALLET_SECRET from env if not provided
    const cdp = new CdpClient(
      cdpConfig?.apiKeyId
        ? {
            apiKeyId: cdpConfig.apiKeyId,
            apiKeySecret: cdpConfig.apiKeySecret!,
            walletSecret: cdpConfig.walletSecret!,
          }
        : undefined,
    );

    // Create an EVM account (acts as the signer for x402 payments)
    const account = await cdp.evm.createAccount();
    this.walletAddress = account.address;

    // Build x402 client with EVM payment scheme
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: account as any });

    // Wrap fetch so 402 responses are automatically paid and retried
    this.paymentFetch = wrapFetchWithPayment(fetch, client);
  }

  getWalletAddress(): string | null {
    return this.walletAddress;
  }

  async request(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<{ status: number; data: unknown; receipt?: Receipt }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options?.headers,
    };

    // Add idempotency key
    const idempotencyKey = options?.idempotencyKey || uuidv4();
    headers[HEADERS.IDEMPOTENCY_KEY] = idempotencyKey;

    // Add mandate header if present
    if (this.mandate) {
      headers[HEADERS.MANDATE] = Buffer.from(JSON.stringify(this.mandate)).toString("base64");
    }

    const res = await this.paymentFetch(url, {
      method,
      headers,
      body: options?.body && method !== "GET" && method !== "HEAD"
        ? JSON.stringify(options.body)
        : undefined,
    });

    const data = await res.json().catch(() => null);

    // Extract receipt from response header or body
    let receipt: Receipt | undefined;
    const receiptHeader = res.headers.get(HEADERS.RECEIPT);
    if (receiptHeader) {
      try {
        receipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf-8"));
      } catch { /* ignore parse errors */ }
    }

    // Check if body is a receipt (e.g. on 403/409/404)
    if (!receipt && data && typeof data === "object" && "outcome" in data && "reason_code" in data) {
      receipt = data as Receipt;
    }

    if (receipt) {
      this.receipts.push(receipt);
    }

    return { status: res.status, data, receipt };
  }

  getReceipts(): Receipt[] {
    return [...this.receipts];
  }

  getTotalSpent(): number {
    return this.receipts
      .filter((r) => r.outcome === Outcome.SUCCESS)
      .reduce((sum, r) => sum + parseFloat(r.price_usdc), 0);
  }

  dumpReceipts(): string {
    return JSON.stringify(this.receipts, null, 2);
  }
}
