export interface ReplayStore {
  has(hash: string): Promise<boolean>;
  insert(hash: string, ttlMs: number): Promise<void>;
}

export class InMemoryReplayStore implements ReplayStore {
  private store = new Map<string, NodeJS.Timeout>();

  async has(hash: string): Promise<boolean> {
    return this.store.has(hash);
  }

  async insert(hash: string, ttlMs: number): Promise<void> {
    const timer = setTimeout(() => {
      this.store.delete(hash);
    }, ttlMs);
    timer.unref();
    this.store.set(hash, timer);
  }

  destroy(): void {
    for (const timer of this.store.values()) {
      clearTimeout(timer);
    }
    this.store.clear();
  }
}

export async function checkReplay(
  store: ReplayStore,
  hash: string,
  ttlMs: number,
): Promise<boolean> {
  if (await store.has(hash)) {
    return true;
  }
  await store.insert(hash, ttlMs);
  return false;
}
