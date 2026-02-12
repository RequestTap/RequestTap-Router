import { v4 as uuidv4 } from "uuid";
import { HEADERS, type Mandate, type Receipt, Outcome } from "@requesttap/shared";

export interface RequestTapClientOptions {
  gatewayBaseUrl: string;
  mandate?: Mandate;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  idempotencyKey?: string;
}

export class RequestTapClient {
  private baseUrl: string;
  private mandate?: Mandate;
  private receipts: Receipt[] = [];
  private paymentFetch: typeof fetch = fetch;

  constructor(options: RequestTapClientOptions) {
    this.baseUrl = options.gatewayBaseUrl.replace(/\/$/, "");
    this.mandate = options.mandate;
  }

  async init(): Promise<void> {
    // In production, this would:
    // 1. Create a CDP server wallet via @coinbase/cdp-sdk
    // 2. Configure x402 client with the wallet signer
    // 3. Wrap fetch with automatic 402 payment handling via @x402/fetch
    //
    // const cdp = new CdpClient({
    //   apiKeyId: process.env.CDP_API_KEY_ID,
    //   apiKeySecret: process.env.CDP_API_KEY_SECRET,
    //   walletSecret: process.env.CDP_WALLET_SECRET,
    // });
    // const wallet = await cdp.evm.createWallet({ network: "base-sepolia" });
    // this.paymentFetch = wrapFetchWithPayment(fetch, wallet);
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
