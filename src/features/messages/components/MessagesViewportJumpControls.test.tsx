// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessagesViewportJumpControls } from "./MessagesViewportJumpControls";

const labels = {
  jumpToStart: "Jump to start of conversation",
  jumpToLatest: "Jump to latest message",
  prevMessage: "Previous message",
  nextMessage: "Next message",
};

function renderControls(
  overrides: Partial<Parameters<typeof MessagesViewportJumpControls>[0]> = {},
) {
  const props = {
    canJumpToStart: true,
    canJumpToLatest: true,
    canPrevMessage: true,
    canNextMessage: true,
    onJumpToStart: vi.fn(),
    onJumpToLatest: vi.fn(),
    onPrevMessage: vi.fn(),
    onNextMessage: vi.fn(),
    labels,
    ...overrides,
  };
  render(
    <MessagesViewportJumpControls {...props}>
      <div data-testid="rail-slot" />
    </MessagesViewportJumpControls>,
  );
  return props;
}

describe("MessagesViewportJumpControls", () => {
  it("renders the four chevrons with the rail slot between the groups", () => {
    renderControls();
    expect(screen.getByTestId("messages-nav-jump-start")).toBeTruthy();
    expect(screen.getByTestId("messages-nav-prev")).toBeTruthy();
    expect(screen.getByTestId("messages-nav-next")).toBeTruthy();
    expect(screen.getByTestId("messages-nav-jump-latest")).toBeTruthy();
    // The rail (children) sits between the up-group and the down-group.
    const rail = screen.getByTestId("rail-slot");
    const upGroup = screen
      .getByTestId("messages-nav-jump-start")
      .closest(".messages-nav-group");
    const downGroup = screen
      .getByTestId("messages-nav-jump-latest")
      .closest(".messages-nav-group");
    expect(rail.previousElementSibling).toBe(upGroup);
    expect(rail.nextElementSibling).toBe(downGroup);
  });

  it("each chevron fires its own handler", () => {
    const props = renderControls();
    fireEvent.click(screen.getByTestId("messages-nav-jump-start"));
    fireEvent.click(screen.getByTestId("messages-nav-prev"));
    fireEvent.click(screen.getByTestId("messages-nav-next"));
    fireEvent.click(screen.getByTestId("messages-nav-jump-latest"));
    expect(props.onJumpToStart).toHaveBeenCalledTimes(1);
    expect(props.onPrevMessage).toHaveBeenCalledTimes(1);
    expect(props.onNextMessage).toHaveBeenCalledTimes(1);
    expect(props.onJumpToLatest).toHaveBeenCalledTimes(1);
  });

  it("disables a chevron at its extreme instead of hiding it", () => {
    renderControls({ canJumpToStart: false, canPrevMessage: false });
    // Still rendered (stable layout + double-chevron grouping), but disabled.
    expect(screen.getByTestId("messages-nav-jump-start")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("messages-nav-prev")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("messages-nav-next")).toHaveProperty("disabled", false);
    expect(screen.getByTestId("messages-nav-jump-latest")).toHaveProperty("disabled", false);
  });

  it("exposes distinct descriptive aria-labels on every chevron", () => {
    renderControls();
    expect(screen.getByLabelText(labels.jumpToStart)).toBeTruthy();
    expect(screen.getByLabelText(labels.prevMessage)).toBeTruthy();
    expect(screen.getByLabelText(labels.nextMessage)).toBeTruthy();
    expect(screen.getByLabelText(labels.jumpToLatest)).toBeTruthy();
  });
});
