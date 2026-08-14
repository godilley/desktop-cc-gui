// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_READ_STATE_KEY,
  SESSION_RADAR_RECENT_STORAGE_KEY,
} from "./sessionRadarPersistence";
import { deleteSessionRadarHistoryEntries } from "./sessionRadarHistoryManagement";

const clientStoreCache = new Map<string, unknown>();
const writeOrder: string[] = [];

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: vi.fn((store: string, key: string) => clientStoreCache.get(`${store}:${key}`)),
  writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
    clientStoreCache.set(`${store}:${key}`, value);
    writeOrder.push(key);
  }),
}));

describe("deleteSessionRadarHistoryEntries write order", () => {
  beforeEach(() => {
    clientStoreCache.clear();
    writeOrder.length = 0;
    vi.clearAllMocks();
  });

  it("persists the dismissed cutoff before the recent list to close the crash window", () => {
    const now = Date.now();
    clientStoreCache.set(`${RADAR_STORE_NAME}:${SESSION_RADAR_RECENT_STORAGE_KEY}`, [
      {
        id: "ws-a:t-1",
        workspaceId: "ws-a",
        threadId: "t-1",
        completedAt: now - 1000,
        startedAt: null,
        durationMs: null,
      },
    ]);
    clientStoreCache.set(`${RADAR_STORE_NAME}:${SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY}`, {});
    clientStoreCache.set(`${RADAR_STORE_NAME}:${SESSION_RADAR_READ_STATE_KEY}`, {});

    const result = deleteSessionRadarHistoryEntries([{ id: "ws-a:t-1", completedAt: now - 1000 }]);
    expect(result.failed).toEqual([]);

    const dismissedWriteIndex = writeOrder.indexOf(SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY);
    const recentWriteIndex = writeOrder.indexOf(SESSION_RADAR_RECENT_STORAGE_KEY);
    expect(dismissedWriteIndex).toBeGreaterThanOrEqual(0);
    expect(recentWriteIndex).toBeGreaterThanOrEqual(0);
    // 崩溃窗口语义：若进程在两次写之间退出，已落盘的 cutoff 必须能压制 recent 中
    // 尚未移除的残留条目，因此 dismissed 必须先于 recent 落盘。
    expect(dismissedWriteIndex).toBeLessThan(recentWriteIndex);
  });
});
