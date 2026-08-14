/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let focusState = false;
const setTitleMock = vi.fn(async () => undefined);
const closeMock = vi.fn(async () => undefined);
const refreshFilesMock = vi.fn(async () => undefined);
const refreshGitStatusMock = vi.fn(async () => undefined);
const useCodeCssVarsMock = vi.fn();
const loadDetachedFileExplorerStylesMock = vi.fn(async () => undefined);
const configureDetachedExternalChangeMonitorMock = vi.fn(async (): Promise<{
  mode: "watcher" | "polling";
  fallbackReason?: string | null;
}> => ({ mode: "watcher" }));
const clearDetachedExternalChangeMonitorMock = vi.fn(async () => undefined);
type MockDetachedSession = {
  windowLabel?: string | null;
  workspaceId: string;
  workspacePath: string;
  workspaceName: string;
  gitRoot: string | null;
  initialFilePath: string | null;
  defaultSidebarCollapsed?: boolean;
  updatedAt: number;
};

let detachedSession: MockDetachedSession = {
  workspaceId: "ws-1",
  workspacePath: "/tmp/workspace",
  workspaceName: "workspace",
  gitRoot: "nested/repo",
  initialFilePath: null as string | null,
  updatedAt: 1,
};
const useWorkspaceFilesMock = vi.fn(() => ({
  files: ["src/index.ts"],
  directories: ["src"],
  gitignoredFiles: new Set<string>(),
  gitignoredDirectories: new Set<string>(),
  isLoading: false,
  refreshFiles: refreshFilesMock,
}));
const useGitStatusMock = vi.fn(() => ({
  status: {
    files: [{ path: "src/index.ts", status: "M", additions: 2, deletions: 1 }],
  },
  refresh: refreshGitStatusMock,
}));
const fileExplorerWorkspaceMock = vi.fn(() => <div data-testid="detached-workspace" />);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../app/hooks/useAppSettingsController", () => ({
  useAppSettingsController: () => ({
    appSettings: {
      uiFontFamily: "Test UI Font",
      codeFontFamily: "Test Code Font",
      codeFontSize: 15,
      theme: "light",
    },
    reduceTransparency: true,
  }),
}));

vi.mock("../../app/hooks/useCodeCssVars", () => ({
  useCodeCssVars: (...args: any[]) => (useCodeCssVarsMock as any)(...args),
}));

vi.mock("../../../styles/featureStyleLoaders", () => ({
  loadDetachedFileExplorerStyles: (...args: any[]) =>
    (loadDetachedFileExplorerStylesMock as any)(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setTitle: setTitleMock,
    close: closeMock,
  })),
}));

vi.mock("../../workspaces/hooks/useWorkspaceFiles", () => ({
  useWorkspaceFiles: (...args: any[]) => (useWorkspaceFilesMock as any)(...args),
}));
vi.mock("../../git/hooks/useGitStatus", () => ({
  useGitStatus: (...args: any[]) => (useGitStatusMock as any)(...args),
}));

vi.mock("../../layout/hooks/useWindowFocusState", () => ({
  useWindowFocusState: () => focusState,
}));

vi.mock("../../app/hooks/useOpenAppIcons", () => ({
  useOpenAppIcons: () => ({}),
}));

vi.mock("../../../utils/platform", () => ({
  isWindowsPlatform: () => false,
  isMacPlatform: () => true,
}));

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: vi.fn(() => "vscode"),
}));

vi.mock("../../../services/tauri", () => ({
  configureDetachedExternalChangeMonitor: (...args: any[]) =>
    (configureDetachedExternalChangeMonitorMock as any)(...args),
  clearDetachedExternalChangeMonitor: (...args: any[]) =>
    (clearDetachedExternalChangeMonitorMock as any)(...args),
}));

vi.mock("../hooks/useDetachedFileExplorerSession", () => ({
  useDetachedFileExplorerSession: () => detachedSession,
}));

vi.mock("./FileExplorerWorkspace", () => ({
  FileExplorerWorkspace: (props: any) => (fileExplorerWorkspaceMock as any)(props),
}));

import { DetachedFileExplorerWindow } from "./DetachedFileExplorerWindow";

describe("DetachedFileExplorerWindow", () => {
  beforeEach(() => {
    focusState = false;
    detachedSession = {
      workspaceId: "ws-1",
      workspacePath: "/tmp/workspace",
      workspaceName: "workspace",
      gitRoot: "nested/repo",
      initialFilePath: null,
      updatedAt: 1,
    };
    setTitleMock.mockClear();
    closeMock.mockClear();
    refreshFilesMock.mockClear();
    refreshGitStatusMock.mockClear();
    useCodeCssVarsMock.mockClear();
    loadDetachedFileExplorerStylesMock.mockClear();
    useWorkspaceFilesMock.mockClear();
    useGitStatusMock.mockClear();
    fileExplorerWorkspaceMock.mockClear();
    configureDetachedExternalChangeMonitorMock.mockClear();
    clearDetachedExternalChangeMonitorMock.mockClear();
  });

  it("uses detached focus state to drive polling and refresh", () => {
    const { container, rerender } = render(<DetachedFileExplorerWindow />);

    expect(screen.getByTestId("detached-workspace")).not.toBeNull();
    expect(useWorkspaceFilesMock).toHaveBeenCalledWith({
      activeWorkspace: expect.objectContaining({
        id: "ws-1",
        path: "/tmp/workspace",
        settings: expect.objectContaining({
          gitRoot: "nested/repo",
        }),
      }),
      pollingEnabled: false,
    });
    expect(useGitStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ws-1",
        path: "/tmp/workspace",
      }),
      { pollingEnabled: false },
    );
    expect(fileExplorerWorkspaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        gitRoot: "nested/repo",
        gitStatusFiles: [{ path: "src/index.ts", status: "M", additions: 2, deletions: 1 }],
        fileViewHeaderLayout: "single-row",
        defaultSidebarCollapsed: false,
      }),
    );
    expect(useCodeCssVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uiFontFamily: "Test UI Font",
        codeFontFamily: "Test Code Font",
      }),
    );
    expect(loadDetachedFileExplorerStylesMock).toHaveBeenCalledTimes(1);
    expect(container.firstElementChild?.className).toContain("app");
    expect(container.firstElementChild?.className).toContain("layout-desktop");
    expect(container.firstElementChild?.className).toContain("macos-desktop");
    expect(container.firstElementChild?.className).toContain("reduced-transparency");
    const detachedStyle = container.firstElementChild?.getAttribute("style") ?? "";
    expect(detachedStyle).toContain("--ui-font-family: Test UI Font");
    expect(detachedStyle).toContain("--code-font-family: Test Code Font");
    expect(detachedStyle).toContain("--code-font-size: 15px");
    expect(detachedStyle).toContain("--client-content-font-size: var(--app-font-size-md)");
    expect(detachedStyle).toContain("--client-meta-font-size: var(--app-font-size-sm)");

    focusState = true;
    rerender(<DetachedFileExplorerWindow />);

    expect(refreshFilesMock).toHaveBeenCalled();
    expect(refreshGitStatusMock).toHaveBeenCalled();
    expect(setTitleMock).toHaveBeenCalledWith("workspace · File Explorer");
    expect(clearDetachedExternalChangeMonitorMock).toHaveBeenCalledWith("ws-1");
  });

  it("normalizes restored absolute paths for the detached fixed sample matrix", () => {
    detachedSession = {
      ...detachedSession,
      initialFilePath: "/tmp/workspace/build.gradle.kts",
      updatedAt: 2,
    };

    render(<DetachedFileExplorerWindow />);

    expect(fileExplorerWorkspaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeFilePath: "build.gradle.kts",
        openTabs: ["build.gradle.kts"],
        navigationTarget: null,
      }),
    );
  });

  it("passes the detached session sidebar collapse preference to the workspace", () => {
    detachedSession = {
      ...detachedSession,
      initialFilePath: "src/index.ts",
      defaultSidebarCollapsed: true,
      updatedAt: 5,
    };

    render(<DetachedFileExplorerWindow />);

    expect(fileExplorerWorkspaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultSidebarCollapsed: true,
      }),
    );
  });

  it("keeps per-tab detached windows on the shared detached menubar drag chrome", () => {
    detachedSession = {
      ...detachedSession,
      windowLabel: "file-explorer-tab-demo",
      initialFilePath: "src/index.ts",
      defaultSidebarCollapsed: true,
      updatedAt: 6,
    };

    render(<DetachedFileExplorerWindow />);

    expect(fileExplorerWorkspaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultSidebarCollapsed: true,
        fileViewHeaderLayout: "single-row",
      }),
    );
  });

  it("marks the detached menubar and title copy as window drag regions", () => {
    render(<DetachedFileExplorerWindow />);

    expect(
      document.querySelector(".detached-file-explorer-menubar")?.getAttribute(
        "data-tauri-drag-region",
      ),
    ).toBe("true");
    expect(
      document.querySelector(".detached-file-explorer-menubar-copy")?.getAttribute(
        "data-tauri-drag-region",
      ),
    ).toBe("true");
    expect(
      document.querySelector(".detached-file-explorer-menubar-title")?.getAttribute(
        "data-tauri-drag-region",
      ),
    ).toBe("true");
  });

  it("normalizes Windows-style detached restores case-insensitively", () => {
    detachedSession = {
      workspaceId: "ws-win",
      workspacePath: "C:/Repo",
      workspaceName: "Repo",
      gitRoot: null,
      initialFilePath: "c:\\repo\\Dockerfile",
      updatedAt: 3,
    };

    render(<DetachedFileExplorerWindow />);

    expect(fileExplorerWorkspaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeFilePath: "Dockerfile",
        openTabs: ["Dockerfile"],
        navigationTarget: null,
      }),
    );
  });

  it("uses event transport when the backend monitor falls back to metadata polling", async () => {
    focusState = true;
    detachedSession = {
      ...detachedSession,
      initialFilePath: "src/index.ts",
      updatedAt: 4,
    };
    configureDetachedExternalChangeMonitorMock.mockResolvedValueOnce({
      mode: "polling",
      fallbackReason: "watcher-disabled-by-setting",
    });

    render(<DetachedFileExplorerWindow />);

    await waitFor(() => {
      expect(configureDetachedExternalChangeMonitorMock).toHaveBeenCalledWith(
        "ws-1",
        "/tmp/workspace",
        "src/index.ts",
        true,
      );
    });
    await waitFor(() => {
      expect(fileExplorerWorkspaceMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          externalChangeTransportMode: "watcher",
        }),
      );
    });
  });
});
