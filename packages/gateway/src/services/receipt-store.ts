import type { Receipt } from "@requesttap/shared";

export class ReceiptStore {
  private receipts: Receipt[] = [];

  add(receipt: Receipt): void {
    this.receipts.push(receipt);
  }

  query(filter?: { tool_id?: string; outcome?: string }): Receipt[] {
    if (!filter) return [...this.receipts];
    return this.receipts.filter((r) => {
      if (filter.tool_id && r.tool_id !== filter.tool_id) return false;
      if (filter.outcome && r.outcome !== filter.outcome) return false;
      return true;
    });
  }

  export(): Receipt[] {
    return [...this.receipts];
  }

  clear(): void {
    this.receipts = [];
  }
}
