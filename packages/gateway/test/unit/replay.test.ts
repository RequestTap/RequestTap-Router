import { InMemoryReplayStore, checkReplay } from "../../src/replay.js";

describe("replay", () => {
  let store: InMemoryReplayStore;

  beforeEach(() => {
    store = new InMemoryReplayStore();
  });

  afterEach(() => {
    store.destroy();
  });

  test("new hash is allowed", async () => {
    const isReplay = await checkReplay(store, "0xaaa", 5000);
    expect(isReplay).toBe(false);
  });

  test("same hash within TTL is rejected", async () => {
    await checkReplay(store, "0xbbb", 5000);
    const isReplay = await checkReplay(store, "0xbbb", 5000);
    expect(isReplay).toBe(true);
  });

  test("expired hash is allowed again", async () => {
    await checkReplay(store, "0xccc", 50); // 50ms TTL
    await new Promise((r) => setTimeout(r, 100)); // wait for expiry
    const isReplay = await checkReplay(store, "0xccc", 50);
    expect(isReplay).toBe(false);
  });
});
