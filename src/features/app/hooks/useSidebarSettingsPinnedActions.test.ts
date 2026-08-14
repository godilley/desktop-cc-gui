// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY,
  SIDEBAR_SETTINGS_PINNED_MAX,
  readSidebarSettingsPinnedActionIds,
  toggleSidebarSettingsPinnedActionId,
  useSidebarSettingsPinnedActions,
} from "./useSidebarSettingsPinnedActions";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

describe("useSidebarSettingsPinnedActions", () => {
  beforeEach(() => {
    vi.mocked(getClientStoreSync).mockReset();
    vi.mocked(writeClientStoreValue).mockReset();
    vi.mocked(getClientStoreSync).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads only known pinnable action ids", () => {
    vi.mocked(getClientStoreSync).mockReturnValue([
      "lock",
      "unknown",
      "spec-hub",
      12,
    ]);
    expect(readSidebarSettingsPinnedActionIds()).toEqual(["lock", "spec-hub"]);
  });

  it("pins until the max of two, then ignores further pins", () => {
    const store: string[] = [];
    vi.mocked(getClientStoreSync).mockImplementation(() => [...store]);
    vi.mocked(writeClientStoreValue).mockImplementation((_ns, _key, value) => {
      store.splice(0, store.length, ...(value as string[]));
    });

    expect(toggleSidebarSettingsPinnedActionId("lock")).toEqual(["lock"]);
    expect(toggleSidebarSettingsPinnedActionId("spec-hub")).toEqual([
      "lock",
      "spec-hub",
    ]);
    // 已满 2 个，再 pin 保持不变
    expect(toggleSidebarSettingsPinnedActionId("git-history")).toEqual([
      "lock",
      "spec-hub",
    ]);
    expect(writeClientStoreValue).toHaveBeenCalledTimes(2);
    expect(SIDEBAR_SETTINGS_PINNED_MAX).toBe(2);

    // 取消一个后再 pin 成功
    expect(toggleSidebarSettingsPinnedActionId("lock")).toEqual(["spec-hub"]);
    expect(toggleSidebarSettingsPinnedActionId("git-history")).toEqual([
      "spec-hub",
      "git-history",
    ]);
  });

  it("unpins an existing id", () => {
    const store = ["project-memory", "runtime-notice"];
    vi.mocked(getClientStoreSync).mockImplementation(() => [...store]);
    vi.mocked(writeClientStoreValue).mockImplementation((_ns, _key, value) => {
      store.splice(0, store.length, ...(value as string[]));
    });

    expect(toggleSidebarSettingsPinnedActionId("project-memory")).toEqual([
      "runtime-notice",
    ]);
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "app",
      SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY,
      ["runtime-notice"],
    );
  });

  it("syncs hook state through the change event", () => {
    const store: string[] = [];
    vi.mocked(getClientStoreSync).mockImplementation(() => [...store]);
    vi.mocked(writeClientStoreValue).mockImplementation((_ns, _key, value) => {
      store.splice(0, store.length, ...(value as string[]));
    });

    const { result } = renderHook(() => useSidebarSettingsPinnedActions());
    expect(result.current.pinnedIds).toEqual([]);
    expect(result.current.maxPinned).toBe(2);

    act(() => {
      result.current.togglePinned("lock");
    });
    expect(result.current.pinnedIds).toEqual(["lock"]);

    act(() => {
      result.current.togglePinned("spec-hub");
    });
    expect(result.current.pinnedIds).toEqual(["lock", "spec-hub"]);

    act(() => {
      result.current.togglePinned("git-history");
    });
    expect(result.current.pinnedIds).toEqual(["lock", "spec-hub"]);
  });
});
