/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockCodeMirrorDispatch } from "./FileViewPanel.test-utils";
import { FileViewPanel } from "./FileViewPanel";
import { clearFileDocumentSessionCacheForTests } from "../hooks/useFileDocumentState";
import {
  getCodeIntelDefinition,
  getCodeIntelImplementations,
  getCodeIntelReferences,
  readWorkspaceFile,
  writeExternalSpecFile,
  writeWorkspaceFile,
} from "../../../services/tauri";
import {
  writeClientStoreData,
  writeClientStoreValue,
} from "../../../services/clientStorage";

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: vi.fn(),
  writeClientStoreData: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

describe("FileViewPanel typing latency contract", () => {
  afterEach(() => {
    cleanup();
    clearFileDocumentSessionCacheForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
    mockCodeMirrorDispatch.mockReset();
  });

  it("keeps typing local-first without per-keystroke Tauri or clientStorage writes", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 1;",
      truncated: false,
    });

    render(
      <FileViewPanel
        workspaceId="ws-typing-latency"
        workspacePath="/repo"
        filePath="src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = (await screen.findByTestId("mock-codemirror")) as HTMLTextAreaElement;
    vi.mocked(writeWorkspaceFile).mockClear();
    vi.mocked(writeExternalSpecFile).mockClear();
    vi.mocked(writeClientStoreData).mockClear();
    vi.mocked(writeClientStoreValue).mockClear();
    vi.mocked(getCodeIntelDefinition).mockClear();
    vi.mocked(getCodeIntelImplementations).mockClear();
    vi.mocked(getCodeIntelReferences).mockClear();

    fireEvent.change(editor, { target: { value: "const value = 2;" } });
    fireEvent.change(editor, { target: { value: "const value = 3;" } });
    fireEvent.change(editor, { target: { value: "const value = 4;" } });

    expect(editor.value).toBe("const value = 4;");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(writeExternalSpecFile).not.toHaveBeenCalled();
    expect(writeClientStoreData).not.toHaveBeenCalled();
    expect(writeClientStoreValue).not.toHaveBeenCalled();
    expect(getCodeIntelDefinition).not.toHaveBeenCalled();
    expect(getCodeIntelImplementations).not.toHaveBeenCalled();
    expect(getCodeIntelReferences).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 160));
    });

    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(writeExternalSpecFile).not.toHaveBeenCalled();
    expect(writeClientStoreData).not.toHaveBeenCalled();
    expect(writeClientStoreValue).not.toHaveBeenCalled();
    expect(getCodeIntelDefinition).not.toHaveBeenCalled();
    expect(getCodeIntelImplementations).not.toHaveBeenCalled();
    expect(getCodeIntelReferences).not.toHaveBeenCalled();
  });

  it("keeps large edit-mode typing local-first in proxy smoke coverage", async () => {
    const largeContent = Array.from(
      { length: 5_000 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: largeContent,
      truncated: false,
    });

    render(
      <FileViewPanel
        workspaceId="ws-typing-large"
        workspacePath="/repo"
        filePath="src/large.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = (await screen.findByTestId("mock-codemirror")) as HTMLTextAreaElement;
    vi.mocked(writeWorkspaceFile).mockClear();
    vi.mocked(writeExternalSpecFile).mockClear();
    vi.mocked(writeClientStoreData).mockClear();
    vi.mocked(writeClientStoreValue).mockClear();

    const nextContent = `${largeContent}\nlocal edit`;
    fireEvent.change(editor, { target: { value: nextContent } });

    expect(editor.value).toBe(nextContent);
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(writeExternalSpecFile).not.toHaveBeenCalled();
    expect(writeClientStoreData).not.toHaveBeenCalled();
    expect(writeClientStoreValue).not.toHaveBeenCalled();
  });

  it("debounces active code anchor derivation for line switching", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "function alpha() {\n  return 1;\n}\n\nfunction beta() {\n  return 2;\n}\n",
      truncated: false,
    });
    const onActiveCodeAnchorChange = vi.fn();

    render(
      <FileViewPanel
        workspaceId="ws-line-anchor"
        workspacePath="/repo"
        filePath="src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        onActiveCodeAnchorChange={onActiveCodeAnchorChange}
      />,
    );

    const editor = (await screen.findByTestId("mock-codemirror")) as HTMLTextAreaElement;
    vi.useFakeTimers();
    onActiveCodeAnchorChange.mockClear();

    const returnOffset = editor.value.indexOf("return 1");
    editor.setSelectionRange(returnOffset, returnOffset);
    fireEvent.select(editor);

    expect(onActiveCodeAnchorChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(onActiveCodeAnchorChange).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });
    expect(onActiveCodeAnchorChange).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(90);
      await Promise.resolve();
    });
    expect(onActiveCodeAnchorChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/value.ts",
        symbolName: "alpha",
        startLine: 1,
      }),
    );
  });

  it("flushes latest editor draft before save when parent publish is pending", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 1;",
      truncated: false,
    });
    vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);

    render(
      <FileViewPanel
        workspaceId="ws-save-latest"
        workspacePath="/repo"
        filePath="src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = (await screen.findByTestId("mock-codemirror")) as HTMLTextAreaElement;
    vi.mocked(writeWorkspaceFile).mockClear();

    fireEvent.change(editor, { target: { value: "const value = 42;" } });

    fireEvent.keyDown(window, {
      key: "s",
      code: "KeyS",
      metaKey: true,
    });
    fireEvent.keyDown(window, {
      key: "s",
      code: "KeyS",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(writeWorkspaceFile).toHaveBeenCalledWith(
        "ws-save-latest",
        "src/value.ts",
        "const value = 42;",
      );
    });
  });

  it("shows a cached clean document snapshot immediately and refreshes it from disk", async () => {
    vi.mocked(readWorkspaceFile).mockImplementation(async (_workspaceId, path) => ({
      content: path === "src/A.ts" ? "const a = 1;" : "const b = 1;",
      truncated: false,
    }));

    const baseProps = {
      workspaceId: "ws-clean-tab-cache",
      workspacePath: "/repo",
      openTargets: [],
      openAppIconById: {},
      selectedOpenAppId: "",
      onSelectOpenAppId: vi.fn(),
      onClose: vi.fn(),
      openTabs: ["src/A.ts", "src/B.ts"],
      onActivateTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseAllTabs: vi.fn(),
    };
    const { rerender } = render(
      <FileViewPanel
        {...baseProps}
        filePath="src/A.ts"
        activeTabPath="src/A.ts"
      />,
    );

    let editor = (await screen.findByTestId("mock-codemirror")) as HTMLTextAreaElement;
    expect(editor.value).toBe("const a = 1;");

    rerender(
      <FileViewPanel
        {...baseProps}
        filePath="src/B.ts"
        activeTabPath="src/B.ts"
      />,
    );
    await waitFor(() => {
      expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value).toBe(
        "const b = 1;",
      );
    });

    rerender(
      <FileViewPanel
        {...baseProps}
        filePath="src/A.ts"
        activeTabPath="src/A.ts"
      />,
    );

    editor = screen.getByTestId("mock-codemirror") as HTMLTextAreaElement;
    expect(editor.value).toBe("const a = 1;");
    expect(readWorkspaceFile).toHaveBeenCalledWith("ws-clean-tab-cache", "src/A.ts");
    await waitFor(() => {
      expect(
        vi.mocked(readWorkspaceFile).mock.calls.filter(
          ([workspaceId, path]) =>
            workspaceId === "ws-clean-tab-cache" && path === "src/A.ts",
        ),
      ).toHaveLength(2);
    });
  });

  it("keeps a dirty draft in the file session when switching tabs", async () => {
    vi.mocked(readWorkspaceFile).mockImplementation(async (_workspaceId, path) => ({
      content: path === "src/A.ts" ? "const a = 1;" : "const b = 1;",
      truncated: false,
    }));

    const baseProps = {
      workspaceId: "ws-dirty-tab-cache",
      workspacePath: "/repo",
      openTargets: [],
      openAppIconById: {},
      selectedOpenAppId: "",
      onSelectOpenAppId: vi.fn(),
      onClose: vi.fn(),
      openTabs: ["src/A.ts", "src/B.ts"],
      onActivateTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseAllTabs: vi.fn(),
    };
    const { rerender } = render(
      <FileViewPanel
        {...baseProps}
        filePath="src/A.ts"
        activeTabPath="src/A.ts"
      />,
    );

    const editor = (await screen.findByTestId("mock-codemirror")) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "const a = 2;" } });

    rerender(
      <FileViewPanel
        {...baseProps}
        filePath="src/B.ts"
        activeTabPath="src/B.ts"
      />,
    );
    await waitFor(() => {
      expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value).toBe(
        "const b = 1;",
      );
    });

    rerender(
      <FileViewPanel
        {...baseProps}
        filePath="src/A.ts"
        activeTabPath="src/A.ts"
      />,
    );

    expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value).toBe(
      "const a = 2;",
    );
    expect(
      vi.mocked(readWorkspaceFile).mock.calls.filter(
        ([workspaceId, path]) =>
          workspaceId === "ws-dirty-tab-cache" && path === "src/A.ts",
      ),
    ).toHaveLength(1);
  });
});
