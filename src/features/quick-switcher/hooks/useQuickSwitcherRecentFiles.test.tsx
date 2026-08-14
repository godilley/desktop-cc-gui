// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QUICK_SWITCHER_RECENT_FILES_CHANGED } from "../recentFiles";
import { useQuickSwitcherRecentFiles } from "./useQuickSwitcherRecentFiles";

const storageMocks = vi.hoisted(() => ({
  recentFilesByWorkspace: {} as Record<string, unknown>,
  getClientStoreSync: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: storageMocks.getClientStoreSync,
  writeClientStoreValue: vi.fn(),
}));

describe("useQuickSwitcherRecentFiles", () => {
  beforeEach(() => {
    storageMocks.recentFilesByWorkspace = {};
    storageMocks.getClientStoreSync.mockReset();
    storageMocks.getClientStoreSync.mockImplementation(
      () => storageMocks.recentFilesByWorkspace,
    );
  });

  it("does not refresh source state when an equivalent workspace array is recreated", () => {
    const { result, rerender } = renderHook(
      ({ workspaces }) => useQuickSwitcherRecentFiles(workspaces),
      { initialProps: { workspaces: [{ id: "workspace-1", name: "Workspace" }] } },
    );
    const initialGroups = result.current;
    const readsAfterMount = storageMocks.getClientStoreSync.mock.calls.length;

    rerender({ workspaces: [{ id: "workspace-1", name: "Workspace" }] });

    expect(result.current).toBe(initialGroups);
    expect(storageMocks.getClientStoreSync).toHaveBeenCalledTimes(readsAfterMount);
  });

  it("observes a storage mutation that happens before the listener attaches", () => {
    storageMocks.getClientStoreSync
      .mockReturnValueOnce({})
      .mockReturnValue({
        "workspace-1": [
          {
            workspaceId: "workspace-1",
            path: "src/Recovered.tsx",
            touchedAt: 12,
            source: "ai-modified",
          },
        ],
      });

    const { result } = renderHook(() =>
      useQuickSwitcherRecentFiles([{ id: "workspace-1", name: "Workspace" }]),
    );

    expect(result.current[0]?.files[0]?.path).toBe("src/Recovered.tsx");
  });

  it("updates the projection when a workspace is renamed", () => {
    storageMocks.recentFilesByWorkspace = {
      "workspace-1": [
        {
          workspaceId: "workspace-1",
          path: "README.md",
          touchedAt: 10,
          source: "opened",
        },
      ],
    };
    const { result, rerender } = renderHook(
      ({ name }) =>
        useQuickSwitcherRecentFiles([{ id: "workspace-1", name }]),
      { initialProps: { name: "Before" } },
    );

    rerender({ name: "After" });

    expect(result.current[0]?.workspaceName).toBe("After");
  });

  it("publishes a real recent-file change", () => {
    const { result } = renderHook(() =>
      useQuickSwitcherRecentFiles([{ id: "workspace-1", name: "Workspace" }]),
    );

    storageMocks.recentFilesByWorkspace = {
      "workspace-1": [
        {
          workspaceId: "workspace-1",
          path: "src/App.tsx",
          touchedAt: 10,
          source: "opened",
        },
      ],
    };
    act(() => {
      window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_RECENT_FILES_CHANGED));
    });

    expect(result.current[0]?.files[0]?.path).toBe("src/App.tsx");
  });
});
