import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { TURN_FINAL_META_STORE_KEY } from "../utils/turnFinalMetaStorage";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: clientStorageMocks.getClientStoreSync,
  writeClientStoreValue: clientStorageMocks.writeClientStoreValue,
}));

import { createInitialThreadState, threadReducer } from "./useThreadsReducer";

function assistant(
  partial: Partial<Extract<ConversationItem, { kind: "message" }>> & {
    id: string;
  },
): ConversationItem {
  return {
    kind: "message",
    role: "assistant",
    text: "done",
    ...partial,
  };
}

describe("threadsReducer turn final meta sidecar", () => {
  beforeEach(() => {
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
    clientStorageMocks.getClientStoreSync.mockReturnValue({
      "thread-1": [
        {
          assistantItemId: "live-a1",
          turnId: "turn-1",
          finalCompletedAt: 1_725_000_000_000,
          finalDurationMs: 38_000,
          finalInputTokens: 147_900,
          finalOutputTokens: 849,
          updatedAt: 1_725_000_000_000,
        },
      ],
    });
  });

  it("fills missing footer meta on setThreadItems from the local sidecar", () => {
    const state = createInitialThreadState();
    const next = threadReducer(state, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        assistant({
          id: "history-a1",
          turnId: "turn-1",
          isFinal: true,
          finalCompletedAt: 1_725_000_000_000,
        }),
      ],
    });

    const message = next.itemsByThread["thread-1"]?.[0];
    expect(message).toMatchObject({
      id: "history-a1",
      isFinal: true,
      finalDurationMs: 38_000,
      finalInputTokens: 147_900,
      finalOutputTokens: 849,
      finalCompletedAt: 1_725_000_000_000,
    });
    expect(clientStorageMocks.getClientStoreSync).toHaveBeenCalledWith(
      "threads",
      TURN_FINAL_META_STORE_KEY,
    );
  });

  it("does not overwrite explicit final tokens from history", () => {
    const state = createInitialThreadState();
    const next = threadReducer(state, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        assistant({
          id: "history-a1",
          turnId: "turn-1",
          isFinal: true,
          finalCompletedAt: 1_725_000_000_000,
          finalDurationMs: 10_000,
          finalInputTokens: 1,
          finalOutputTokens: 2,
        }),
      ],
    });

    expect(next.itemsByThread["thread-1"]?.[0]).toMatchObject({
      finalDurationMs: 10_000,
      finalInputTokens: 1,
      finalOutputTokens: 2,
    });
  });
});
