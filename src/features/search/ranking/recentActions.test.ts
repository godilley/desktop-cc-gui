import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClientStoreSync, writeClientStoreValue } = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync,
  writeClientStoreValue,
}));

import {
  normalizeRecentSearchActions,
  RECENT_ACTION_LIMIT,
  recordRecentSearchAction,
} from "./recentActions";

describe("recentActions", () => {
  beforeEach(() => {
    getClientStoreSync.mockReset();
    writeClientStoreValue.mockReset();
  });

  it("sanitizes malformed values, deduplicates and bounds entries", () => {
    const entries = Array.from({ length: RECENT_ACTION_LIMIT + 5 }, (_, index) => ({
      actionId: `action-${index}`,
      executedAt: index,
    }));
    entries.push({ actionId: "action-24", executedAt: 99 });

    const normalized = normalizeRecentSearchActions([null, { actionId: "", executedAt: 1 }, ...entries]);
    expect(normalized).toHaveLength(RECENT_ACTION_LIMIT);
    expect(normalized[0]).toEqual({ actionId: "action-24", executedAt: 99 });
  });

  it("persists only action identity and timestamp", () => {
    getClientStoreSync.mockReturnValue([]);
    recordRecentSearchAction("open-settings", 42);

    expect(writeClientStoreValue).toHaveBeenCalledWith("app", "search.recentActions", [
      { actionId: "open-settings", executedAt: 42 },
    ]);
  });
});
