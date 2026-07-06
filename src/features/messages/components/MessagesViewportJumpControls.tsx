import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import type { ReactNode } from "react";

export type MessagesViewportJumpLabels = {
  jumpToStart: string;
  jumpToLatest: string;
  prevMessage: string;
  nextMessage: string;
};

type MessagesViewportJumpControlsProps = {
  canJumpToStart: boolean;
  canJumpToLatest: boolean;
  canPrevMessage: boolean;
  canNextMessage: boolean;
  onJumpToStart: () => void;
  onJumpToLatest: () => void;
  onPrevMessage: () => void;
  onNextMessage: () => void;
  labels: MessagesViewportJumpLabels;
  /** The anchor rail — rendered between the up and down chevron groups. */
  children?: ReactNode;
};

/**
 * Conversation navigation cluster that wraps the anchor rail with two chevron
 * pairs (above and below it):
 *
 *   ▲ outer-up    → jump to first message
 *   ▲ inner-up    → previous message (anchor)
 *   ─ anchor rail ─
 *   ▼ inner-down  → next message (anchor)
 *   ▼ outer-down  → jump to latest message
 *
 * The "outer" control jumps to the conversation extreme, the "inner" steps one
 * message. The single-vs-double-chevron affordance is achieved purely in CSS by
 * DOM sibling order: hovering an outer chevron highlights BOTH chevrons in its
 * group (reads as a double chevron), hovering an inner highlights only itself —
 * so we get the conventional next/last iconography from two single chevrons
 * instead of rendering a third (double) icon. See messages.status-shell.css.
 */
export function MessagesViewportJumpControls({
  canJumpToStart,
  canJumpToLatest,
  canPrevMessage,
  canNextMessage,
  onJumpToStart,
  onJumpToLatest,
  onPrevMessage,
  onNextMessage,
  labels,
  children,
}: MessagesViewportJumpControlsProps) {
  return (
    <div className="messages-nav-rail" data-testid="messages-nav-rail">
      {/* Up group: outer (jump-to-start) is first in DOM so the CSS
          `.outer:hover ~ .inner` sibling rule can light the inner too. */}
      <div className="messages-nav-group messages-nav-group--up">
        <button
          type="button"
          className="messages-nav-chevron messages-nav-chevron--outer"
          aria-label={labels.jumpToStart}
          title={labels.jumpToStart}
          onClick={onJumpToStart}
          disabled={!canJumpToStart}
          data-testid="messages-nav-jump-start"
        >
          <ChevronUp size={20} aria-hidden />
        </button>
        <button
          type="button"
          className="messages-nav-chevron messages-nav-chevron--inner"
          aria-label={labels.prevMessage}
          title={labels.prevMessage}
          onClick={onPrevMessage}
          disabled={!canPrevMessage}
          data-testid="messages-nav-prev"
        >
          <ChevronUp size={20} aria-hidden />
        </button>
      </div>

      {children}

      {/* Down group: outer (jump-to-latest) is first in DOM for the same
          sibling-hover rule, and rendered at the bottom via column-reverse. */}
      <div className="messages-nav-group messages-nav-group--down">
        <button
          type="button"
          className="messages-nav-chevron messages-nav-chevron--outer"
          aria-label={labels.jumpToLatest}
          title={labels.jumpToLatest}
          onClick={onJumpToLatest}
          disabled={!canJumpToLatest}
          data-testid="messages-nav-jump-latest"
        >
          <ChevronDown size={20} aria-hidden />
        </button>
        <button
          type="button"
          className="messages-nav-chevron messages-nav-chevron--inner"
          aria-label={labels.nextMessage}
          title={labels.nextMessage}
          onClick={onNextMessage}
          disabled={!canNextMessage}
          data-testid="messages-nav-next"
        >
          <ChevronDown size={20} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default MessagesViewportJumpControls;
