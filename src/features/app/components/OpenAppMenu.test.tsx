// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAppMenu } from "./OpenAppMenu";

const useOpenAppIconsMock = vi.fn<
  (targets: unknown, options?: unknown) => Record<string, string>
>(() => ({}));

vi.mock("../../../services/tauri", () => ({
  openWorkspaceIn: vi.fn(),
  revealInFileManager: vi.fn(),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../hooks/useOpenAppIcons", () => ({
  useOpenAppIcons: (...args: unknown[]) => useOpenAppIconsMock(args[0], args[1]),
}));

describe("OpenAppMenu", () => {
  const moreTriggerPattern = /(?:More actions|common\.moreActions)/;
  const pinCheckboxPattern = /(?:Show in toolbar|common\.showInHeader)/;

  beforeEach(() => {
    vi.useFakeTimers();
    useOpenAppIconsMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a tooltip for the more-actions trigger on hover", async () => {
    render(
      <OpenAppMenu
        path="/tmp/demo"
        openTargets={[
          {
            id: "vscode",
            label: "VS Code",
            kind: "app",
            appName: "Visual Studio Code",
            command: null,
            args: [],
          },
        ]}
        selectedOpenAppId="vscode"
        onSelectOpenAppId={vi.fn()}
        iconOnly
      />,
    );

    await act(async () => {
      fireEvent.mouseEnter(screen.getByRole("button", { name: moreTriggerPattern }));
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByRole("tooltip").textContent).toMatch(moreTriggerPattern);
  });

  it("uses only the ellipsis icon for the icon-only more-actions trigger", () => {
    render(
      <OpenAppMenu
        path="/tmp/demo"
        openTargets={[
          {
            id: "vscode",
            label: "VS Code",
            kind: "app",
            appName: "Visual Studio Code",
            command: null,
            args: [],
          },
        ]}
        selectedOpenAppId="vscode"
        onSelectOpenAppId={vi.fn()}
        iconOnly
      />,
    );

    const trigger = screen.getByRole("button", { name: moreTriggerPattern });

    expect(trigger.querySelectorAll("svg")).toHaveLength(1);
  });

  it("only enables lazy icon loading after the menu is opened", () => {
    render(
      <OpenAppMenu
        path="/tmp/demo"
        openTargets={[
          {
            id: "custom-editor",
            label: "Custom Editor",
            kind: "app",
            appName: "Custom Editor",
            command: null,
            args: [],
          },
        ]}
        selectedOpenAppId="custom-editor"
        onSelectOpenAppId={vi.fn()}
        iconOnly
      />,
    );

    expect(useOpenAppIconsMock).toHaveBeenCalledWith(
      [
        {
          id: "custom-editor",
          label: "Custom Editor",
          kind: "app",
          appName: "Custom Editor",
          command: null,
          args: [],
        },
      ],
      { enabled: false },
    );

    fireEvent.click(screen.getByRole("button", { name: moreTriggerPattern }));

    expect(useOpenAppIconsMock).toHaveBeenLastCalledWith(
      [
        {
          id: "custom-editor",
          label: "Custom Editor",
          kind: "app",
          appName: "Custom Editor",
          command: null,
          args: [],
        },
      ],
      { enabled: true },
    );
  });

  it("renders extra header actions inside the selected app menu", () => {
    const onToggleTerminal = vi.fn();

    render(
      <OpenAppMenu
        path="/tmp/demo"
        openTargets={[
          {
            id: "finder",
            label: "Finder",
            kind: "finder",
            args: [],
          },
        ]}
        selectedOpenAppId="finder"
        onSelectOpenAppId={vi.fn()}
        iconOnly
        extraActions={[
          {
            id: "terminal",
            label: "common.toggleTerminalPanel",
            icon: <span>terminal</span>,
            onSelect: onToggleTerminal,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: moreTriggerPattern }));
    fireEvent.click(screen.getByRole("menuitem", { name: /(?:Toggle terminal panel|common\.toggleTerminalPanel)/ }));

    expect(onToggleTerminal).toHaveBeenCalledTimes(1);
  });

  it("toggles header pinning from row checkboxes without firing the row action", () => {
    const onTogglePinned = vi.fn();
    const onToggleTerminal = vi.fn();

    render(
      <OpenAppMenu
        path="/tmp/demo"
        openTargets={[
          {
            id: "vscode",
            label: "VS Code",
            kind: "app",
            appName: "Visual Studio Code",
            command: null,
            args: [],
          },
        ]}
        selectedOpenAppId="vscode"
        onSelectOpenAppId={vi.fn()}
        iconOnly
        extraActions={[
          {
            id: "terminal",
            label: "common.toggleTerminalPanel",
            icon: <span>terminal</span>,
            onSelect: onToggleTerminal,
          },
          {
            id: "launch-script-entry-1",
            label: "entry script",
            icon: <span>entry</span>,
            onSelect: vi.fn(),
            pinnable: false,
          },
        ]}
        pinnedIds={["vscode"]}
        onTogglePinned={onTogglePinned}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: moreTriggerPattern }));

    // vscode 与 terminal 各一个勾选框；pinnable: false 的行没有
    const checkboxes = screen.getAllByRole("checkbox", { name: pinCheckboxPattern });
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(checkboxes[1]);

    expect(onTogglePinned).toHaveBeenCalledWith("terminal");
    expect(onToggleTerminal).not.toHaveBeenCalled();
  });
});
