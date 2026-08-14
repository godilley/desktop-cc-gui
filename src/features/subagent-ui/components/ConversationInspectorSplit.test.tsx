// @vitest-environment jsdom

import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationInspectorSplit } from "./ConversationInspectorSplit";

const getClientStoreSync = vi.fn();
const writeClientStoreValue = vi.fn();

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: (...args: unknown[]) => getClientStoreSync(...args),
  writeClientStoreValue: (...args: unknown[]) =>
    writeClientStoreValue(...args),
}));

function setDesktop(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open inspector
      </button>
      <ConversationInspectorSplit
        messagesNode={<div>Messages</div>}
        composerNode={<div>Composer</div>}
        open={open}
        resizeLabel="Resize inspector"
        onRequestClose={() => setOpen(false)}
        inspectorNode={
          <aside className="subagent-inspector-drawer">
            <h2 tabIndex={-1} data-inspector-initial-focus>
              Inspector heading
            </h2>
            <button type="button" onClick={() => setOpen(false)}>
              Close inspector
            </button>
            <button type="button">Last action</button>
          </aside>
        }
      />
    </>
  );
}

function ReplacedTriggerHarness() {
  const [approved, setApproved] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <ConversationInspectorSplit
      messagesNode={<div>Messages</div>}
      conversationSurface={
        approved ? (
          <button type="button" data-inspector-return-focus>
            View details
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setApproved(true);
              setOpen(true);
            }}
          >
            Confirm plan
          </button>
        )
      }
      composerNode={<div>Composer</div>}
      open={open}
      resizeLabel="Resize inspector"
      onRequestClose={() => setOpen(false)}
      inspectorNode={
        <aside className="subagent-inspector-drawer">
          <h2 tabIndex={-1} data-inspector-initial-focus>
            Inspector heading
          </h2>
          <button type="button" onClick={() => setOpen(false)}>
            Close inspector
          </button>
        </aside>
      }
    />
  );
}

describe("ConversationInspectorSplit", () => {
  beforeEach(() => {
    getClientStoreSync.mockReset();
    writeClientStoreValue.mockReset();
    setDesktop(true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it("moves focus into the inspector and restores the trigger on close", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open inspector" });
    trigger.focus();
    fireEvent.click(trigger);

    const heading = screen.getByText("Inspector heading");
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.click(
      screen.getByRole("button", { name: "Close inspector" }),
    );

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByText("Inspector heading")).toBeNull();
  });

  it("restores a stable card trigger when the approval control was replaced", async () => {
    render(<ReplacedTriggerHarness />);
    const approval = screen.getByRole("button", { name: "Confirm plan" });
    approval.focus();
    fireEvent.click(approval);

    const heading = screen.getByText("Inspector heading");
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));

    const returnTrigger = screen.getByRole("button", { name: "View details" });
    await waitFor(() => expect(document.activeElement).toBe(returnTrigger));
  });

  it("persists a clamped generic split ratio from keyboard resizing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open inspector" }));
    fireEvent.keyDown(
      screen.getByRole("separator", { name: "Resize inspector" }),
      { key: "ArrowRight" },
    );

    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "layout",
      "conversationInspectorSplitRatio",
      60,
    );
  });

  it("contains mobile focus in both directions", async () => {
    setDesktop(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open inspector" }));
    const heading = screen.getByText("Inspector heading");
    const last = screen.getByRole("button", { name: "Last action" });
    await waitFor(() => expect(document.activeElement).toBe(heading));

    fireEvent.keyDown(heading, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(heading);
  });
});
