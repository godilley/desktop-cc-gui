/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  mockCodeMirrorDispatch,
  mockCodeMirrorExtensionTokenSnapshots,
  mockCodeMirrorExtensionsSnapshots,
} from "./FileViewPanel.test-utils";
import { FileViewPanel } from "./FileViewPanel";
import { readWorkspaceFile } from "../../../services/tauri";

const mocks = vi.hoisted(() => {
  const slowTypescript = vi.fn(
    () =>
      new Promise<{ extension: string }[]>((resolve) => {
        setTimeout(() => resolve([{ extension: "ts-stale" }]), 40);
      }),
  );
  const fastOther = vi.fn(async () => [{ extension: "py-fresh" }]);
  return { slowTypescript, fastOther };
});

vi.mock("../utils/codemirrorLanguageExtensions", () => ({
  loadCodeMirrorExtensionsForEditorLanguage: vi.fn(async (lang: string) => {
    if (lang === "typescript") {
      return mocks.slowTypescript();
    }
    return mocks.fastOther();
  }),
  loadCodeMirrorExtensionsForPath: vi.fn(async () => []),
}));

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: vi.fn(),
  writeClientStoreData: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

describe("FileViewPanel file type switching lazy race", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockCodeMirrorDispatch.mockReset();
    mockCodeMirrorExtensionsSnapshots.length = 0;
    mockCodeMirrorExtensionTokenSnapshots.length = 0;
  });

  it("ignores stale language extension loaders when the active file changes mid-flight", async () => {
    // readWorkspaceFile returns content based on the requested file
    // path so the test can detect when the panel swapped the file
    // identity. We use `mockImplementation` rather than chained
    // `mockResolvedValueOnce` to avoid off-by-one races with the
    // document state hook's re-reads.
    vi.mocked(readWorkspaceFile).mockImplementation(async (_ws, path) => {
      if (String(path).endsWith(".ts")) {
        return { content: "const x = 1;", truncated: false };
      }
      if (String(path).endsWith(".py")) {
        return { content: "x = 1", truncated: false };
      }
      return { content: "", truncated: false };
    });

    function Harness() {
      const [path, setPath] = useState("src/a.ts");
      return (
        <div>
          <button
            type="button"
            data-testid="switch-to-py"
            onClick={() => setPath("src/b.py")}
          />
          <FileViewPanel
            workspaceId="ws-lazy-race"
            workspacePath="/repo"
            filePath={path}
            openTargets={[]}
            openAppIconById={{}}
            selectedOpenAppId=""
            onSelectOpenAppId={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      );
    }

    render(<Harness />);
    await screen.findByTestId("mock-codemirror");

    // The typescript loader was triggered at least once for the
    // initial `.ts` file and the slow promise is still in flight.
    await waitFor(() => {
      expect(mocks.slowTypescript).toHaveBeenCalled();
    });

    // Switch the active file before the slow typescript promise
    // resolves. The race guard inside the editor (using the language
    // extension request token) must drop the late result and keep
    // the new file in the active editor language slot.
    const switchButton = screen.getByTestId("switch-to-py");
    act(() => {
      switchButton.click();
    });

    await waitFor(() => {
      const editor = screen.getByTestId("mock-codemirror") as HTMLTextAreaElement;
      expect(editor.value).toBe("x = 1");
    });

    // Wait past the slow typescript timeout to confirm the stale
    // resolution does not get applied to the python editor.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const editor = screen.getByTestId("mock-codemirror") as HTMLTextAreaElement;
    expect(editor.value).toBe("x = 1");
    const latestTokens = mockCodeMirrorExtensionTokenSnapshots.at(-1) ?? [];
    expect(latestTokens).toContain("py-fresh");
    expect(latestTokens).not.toContain("ts-stale");
  });
});
