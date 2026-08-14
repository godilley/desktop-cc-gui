// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, ThreadSummary, WorkspaceInfo } from "../../../types";
import { writeClientStoreValue } from "../../../services/clientStorage";
import {
  RADAR_RECENT_TTL_MS,
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_RECENT_STORAGE_KEY,
} from "../utils/sessionRadarPersistence";
import { deleteSessionRadarHistoryEntries } from "../utils/sessionRadarHistoryManagement";
import { useSessionRadarFeed } from "./useSessionRadarFeed";

const clientStoreCache = new Map<string, unknown>();

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: vi.fn((store: string, key: string) => clientStoreCache.get(`${store}:${key}`)),
  writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
    clientStoreCache.set(`${store}:${key}`, value);
  }),
}));

function createWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    settings: { sidebarCollapsed: true },
    connected: true,
    kind: "main",
  } as unknown as WorkspaceInfo;
}

function createThread(id: string, name: string, updatedAt: number): ThreadSummary {
  return {
    id,
    name,
    updatedAt,
    engineSource: "codex",
  };
}

function createUserMessage(id: string, text: string): ConversationItem {
  return {
    id,
    kind: "message",
    role: "user",
    text,
  } as ConversationItem;
}

function readPersistedRecentIds(): string[] {
  const raw = clientStoreCache.get(`leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`);
  return Array.isArray(raw)
    ? raw.map((entry) => (entry as { id: string }).id)
    : [];
}

describe("useSessionRadarFeed completion reconcile", () => {
  beforeEach(() => {
    clientStoreCache.clear();
    vi.clearAllMocks();
  });

  it("records a completion that finished before app launch", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const updatedAt = Date.now() - 5000;

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [createThread("thread-1", "Pre-launch Thread", updatedAt)],
        },
        threadStatusById: {
          "thread-1": { isProcessing: false, lastDurationMs: 1200 },
        },
        threadItemsByThread: {
          "thread-1": [createUserMessage("item-1", "pre-launch question")],
        },
        lastAgentMessageByThread: {},
      }),
    );

    const entry = result.current.recentCompletedSessions.find(
      (candidate) => candidate.threadId === "thread-1",
    );
    expect(entry).toEqual(
      expect.objectContaining({
        id: "ws-main:thread-1",
        completedAt: updatedAt,
        durationMs: 1200,
      }),
    );
    expect(readPersistedRecentIds()).toContain("ws-main:thread-1");
  });

  it("does not resurrect a completion dismissed by the user", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const updatedAt = Date.now() - 5000;
    clientStoreCache.set(`leida:${SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY}`, {
      "ws-main:thread-1": updatedAt,
    });

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [createThread("thread-1", "Dismissed Thread", updatedAt)],
        },
        threadStatusById: {
          "thread-1": { isProcessing: false },
        },
        threadItemsByThread: {
          "thread-1": [createUserMessage("item-1", "dismissed question")],
        },
        lastAgentMessageByThread: {},
      }),
    );

    expect(result.current.recentCompletedSessions).toHaveLength(0);
    expect(readPersistedRecentIds()).not.toContain("ws-main:thread-1");
  });

  it("does not resurrect a deleted completion whose live updatedAt leads completedAt", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const now = Date.now();
    const completedAt = now - 10_000;
    const liveUpdatedAt = now - 100;
    clientStoreCache.set(`leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`, [
      {
        id: "ws-main:thread-1",
        workspaceId: "ws-main",
        threadId: "thread-1",
        completedAt,
        updatedAt: completedAt,
        startedAt: null,
        durationMs: null,
      },
    ]);

    // 用户删除时条目 updatedAt 已被 live thread 刷新（领先 completedAt），cutoff 必须
    // 覆盖该值；否则 reconcile 会以 thread.updatedAt > cutoff 把条目补写回来。
    const deleteResult = deleteSessionRadarHistoryEntries([
      { id: "ws-main:thread-1", completedAt, liveUpdatedAt },
    ]);
    expect(deleteResult.failed).toEqual([]);
    const dismissed = clientStoreCache.get(
      `leida:${SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY}`,
    ) as Record<string, number>;
    expect(dismissed["ws-main:thread-1"]).toBe(liveUpdatedAt);

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [createThread("thread-1", "Deleted Thread", liveUpdatedAt)],
        },
        threadStatusById: {
          "thread-1": { isProcessing: false },
        },
        threadItemsByThread: {
          "thread-1": [createUserMessage("item-1", "deleted question")],
        },
        lastAgentMessageByThread: {},
      }),
    );

    expect(result.current.recentCompletedSessions).toHaveLength(0);
    expect(readPersistedRecentIds()).not.toContain("ws-main:thread-1");
  });

  it("does not reconcile a thread with zero activity evidence", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const updatedAt = Date.now() - 5000;

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          // 从未运行的空会话：无 items、无 lastAgent 快照，仅有 updatedAt。
          "ws-main": [createThread("thread-empty", "Empty Thread", updatedAt)],
        },
        threadStatusById: {
          "thread-empty": { isProcessing: false },
        },
        threadItemsByThread: {},
        lastAgentMessageByThread: {},
      }),
    );

    expect(result.current.recentCompletedSessions).toHaveLength(0);
    expect(readPersistedRecentIds()).not.toContain("ws-main:thread-empty");
  });

  it("refreshes a persisted completion when the thread updatedAt moves past completedAt", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const now = Date.now();
    const persistedCompletedAt = now - 10_000;
    const liveUpdatedAt = now - 2000;
    clientStoreCache.set(`leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`, [
      {
        id: "ws-main:thread-1",
        workspaceId: "ws-main",
        threadId: "thread-1",
        completedAt: persistedCompletedAt,
        updatedAt: persistedCompletedAt,
        startedAt: null,
        durationMs: null,
      },
    ]);

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [createThread("thread-1", "Advanced Thread", liveUpdatedAt)],
        },
        threadStatusById: {
          "thread-1": { isProcessing: false },
        },
        threadItemsByThread: {
          "thread-1": [createUserMessage("item-1", "follow-up question")],
        },
        lastAgentMessageByThread: {},
      }),
    );

    const entry = result.current.recentCompletedSessions.find(
      (candidate) => candidate.threadId === "thread-1",
    );
    // thread.updatedAt 晚于 persisted.completedAt：reconcile 以 updatedAt 刷新完成记录。
    expect(entry).toEqual(
      expect.objectContaining({
        id: "ws-main:thread-1",
        completedAt: liveUpdatedAt,
      }),
    );
  });

  it("refreshes the merged entry updatedAt from live lastAgent activity", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const now = Date.now();
    const persistedCompletedAt = now - 10_000;
    const lastAgentTimestamp = now - 1000;
    clientStoreCache.set(`leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`, [
      {
        id: "ws-main:thread-1",
        workspaceId: "ws-main",
        threadId: "thread-1",
        completedAt: persistedCompletedAt,
        updatedAt: persistedCompletedAt,
        startedAt: null,
        durationMs: null,
      },
    ]);

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [createThread("thread-1", "Persisted Thread", persistedCompletedAt)],
        },
        threadStatusById: {
          "thread-1": { isProcessing: false },
        },
        threadItemsByThread: {
          "thread-1": [createUserMessage("item-1", "persisted question")],
        },
        lastAgentMessageByThread: {
          "thread-1": { text: "agent reply", timestamp: lastAgentTimestamp },
        },
      }),
    );

    const entry = result.current.recentCompletedSessions.find(
      (candidate) => candidate.threadId === "thread-1",
    );
    // completedAt 保持 persisted 原值；updatedAt 被 live lastAgent 时间戳刷新。
    expect(entry).toEqual(
      expect.objectContaining({
        completedAt: persistedCompletedAt,
        updatedAt: lastAgentTimestamp,
      }),
    );
  });

  it("clamps the reconciled startedAt to zero when duration exceeds updatedAt", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const updatedAt = Date.now() - 1000;

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [createThread("thread-1", "Clamped Thread", updatedAt)],
        },
        threadStatusById: {
          // durationMs 远超 updatedAt：startedAt = max(0, updatedAt - durationMs) 钳到 0。
          "thread-1": { isProcessing: false, lastDurationMs: Date.now() + 60_000 },
        },
        threadItemsByThread: {
          "thread-1": [createUserMessage("item-1", "clamp question")],
        },
        lastAgentMessageByThread: {},
      }),
    );

    const entry = result.current.recentCompletedSessions.find(
      (candidate) => candidate.threadId === "thread-1",
    );
    expect(entry?.startedAt).toBe(0);
  });

  it("skips reconcile candidates that are running, stale, or already recorded", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const now = Date.now();
    clientStoreCache.set(`leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`, [
      {
        id: "ws-main:thread-recorded",
        workspaceId: "ws-main",
        threadId: "thread-recorded",
        completedAt: now - 1000,
        updatedAt: now - 1000,
        startedAt: null,
        durationMs: null,
      },
    ]);

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [
            createThread("thread-running", "Running", now - 100),
            createThread("thread-stale", "Stale", now - RADAR_RECENT_TTL_MS - 1000),
            createThread("thread-recorded", "Recorded", now - 2000),
          ],
        },
        threadStatusById: {
          "thread-running": { isProcessing: true, processingStartedAt: now - 100 },
          "thread-stale": { isProcessing: false },
          "thread-recorded": { isProcessing: false },
        },
        threadItemsByThread: {},
        lastAgentMessageByThread: {},
      }),
    );

    expect(
      result.current.recentCompletedSessions.map((entry) => entry.threadId),
    ).toEqual(["thread-recorded"]);
  });

  it("skips redundant disk writes when the persisted content is unchanged", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const updatedAt = Date.now() - 5000;
    const threadsByWorkspace = {
      "ws-main": [createThread("thread-1", "Stable Thread", updatedAt)],
    };

    const { rerender } = renderHook(
      (props: { threadItemsByThread: Record<string, ConversationItem[]> }) =>
        useSessionRadarFeed({
          workspaces: [workspace],
          threadsByWorkspace,
          threadStatusById: {
            "thread-1": { isProcessing: false },
          },
          threadItemsByThread: props.threadItemsByThread,
          lastAgentMessageByThread: {},
        }),
      {
        initialProps: {
          threadItemsByThread: {
            "thread-1": [createUserMessage("item-1", "stable question")],
          },
        },
      },
    );

    const recentWriteCountAfterMount = vi
      .mocked(writeClientStoreValue)
      .mock.calls.filter(([, key]) => key === SESSION_RADAR_RECENT_STORAGE_KEY).length;
    expect(recentWriteCountAfterMount).toBe(1);

    // 流式期间的引用抖动不应击穿 signature-gated 写盘。
    rerender({
      threadItemsByThread: { "thread-1": [createUserMessage("item-1", "stable question")] },
    });
    rerender({
      threadItemsByThread: { "thread-1": [createUserMessage("item-1", "stable question")] },
    });

    const recentWriteCountAfterRerender = vi
      .mocked(writeClientStoreValue)
      .mock.calls.filter(([, key]) => key === SESSION_RADAR_RECENT_STORAGE_KEY).length;
    expect(recentWriteCountAfterRerender).toBe(1);
  });
});

describe("useSessionRadarFeed lazy persistence pruning", () => {
  beforeEach(() => {
    clientStoreCache.clear();
    vi.clearAllMocks();
  });

  it("converges an oversized legacy store and cleans pruned dismissed records", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const now = Date.now();
    clientStoreCache.set(
      `leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`,
      Array.from({ length: 60 }, (_, index) => ({
        id: `ws-main:t-${index}`,
        workspaceId: "ws-main",
        threadId: `t-${index}`,
        completedAt: now - index * 1000,
        updatedAt: now - index * 1000,
        startedAt: null,
        durationMs: null,
      })),
    );
    clientStoreCache.set(`leida:${SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY}`, {
      "ws-main:t-59": now - 59_000,
      "ws-main:deleted-by-user": now - 1000,
    });

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {},
        threadStatusById: {},
        threadItemsByThread: {},
        lastAgentMessageByThread: {},
      }),
    );

    expect(result.current.recentCompletedSessions).toHaveLength(50);
    expect(readPersistedRecentIds()).toHaveLength(50);
    expect(readPersistedRecentIds()).not.toContain("ws-main:t-59");

    const dismissed = clientStoreCache.get(
      `leida:${SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY}`,
    ) as Record<string, number>;
    // 被 bounds 物理修剪的条目清除 dismissed；用户主动删除的 cutoff 保留以防复活。
    expect(dismissed["ws-main:t-59"]).toBeUndefined();
    expect(dismissed["ws-main:deleted-by-user"]).toBe(now - 1000);
  });

  it("prunes entries older than the 30-day TTL on merge", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const now = Date.now();
    clientStoreCache.set(`leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`, [
      {
        id: "ws-main:t-expired",
        workspaceId: "ws-main",
        threadId: "t-expired",
        completedAt: now - RADAR_RECENT_TTL_MS - 1000,
        updatedAt: now - RADAR_RECENT_TTL_MS - 1000,
        startedAt: null,
        durationMs: null,
      },
      {
        id: "ws-main:t-fresh",
        workspaceId: "ws-main",
        threadId: "t-fresh",
        completedAt: now - 1000,
        updatedAt: now - 1000,
        startedAt: null,
        durationMs: null,
      },
    ]);

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {},
        threadStatusById: {},
        threadItemsByThread: {},
        lastAgentMessageByThread: {},
      }),
    );

    expect(result.current.recentCompletedSessions.map((entry) => entry.id)).toEqual([
      "ws-main:t-fresh",
    ]);
    expect(readPersistedRecentIds()).toEqual(["ws-main:t-fresh"]);
  });

  it("keeps the user cutoff when bounds prunes a reconciled (never persisted) entry", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const now = Date.now();
    // 填满单 workspace 上限的物理快照。
    clientStoreCache.set(
      `leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`,
      Array.from({ length: 50 }, (_, index) => ({
        id: `ws-main:t-${index}`,
        workspaceId: "ws-main",
        threadId: `t-${index}`,
        completedAt: now - index * 1000,
        updatedAt: now - index * 1000,
        startedAt: null,
        durationMs: null,
      })),
    );
    // 用户曾删除 thread-live 的完成记录；之后 thread 又有新活动（updatedAt 越过
    // cutoff），reconcile 会重新合成一条 entry。
    clientStoreCache.set(`leida:${SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY}`, {
      "ws-main:thread-live": now - 120_000,
    });

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          // updatedAt 晚于 cutoff 但早于全部 50 条物理条目：reconcile 合成后立刻被
          // workspace 上限淘汰，成为「从未物理存在」的 pruned id。
          "ws-main": [createThread("thread-live", "Live Thread", now - 60_000)],
        },
        threadStatusById: {
          "thread-live": { isProcessing: false },
        },
        threadItemsByThread: {
          "thread-live": [createUserMessage("item-1", "live question")],
        },
        lastAgentMessageByThread: {},
      }),
    );

    expect(result.current.recentCompletedSessions).toHaveLength(50);
    expect(readPersistedRecentIds()).toHaveLength(50);
    expect(readPersistedRecentIds()).not.toContain("ws-main:thread-live");

    const dismissed = clientStoreCache.get(
      `leida:${SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY}`,
    ) as Record<string, number>;
    // 被 bounds 淘汰的是 reconcile 合成条目（不在 persisted 快照内），其 dismissed
    // cutoff 不得连带销毁，否则下一轮 reconcile 会把它补写回来（复活循环）。
    expect(dismissed["ws-main:thread-live"]).toBe(now - 120_000);
  });
});
