# conversation-scroll-ownership Specification Delta

## ADDED Requirements

### Requirement: A Single Owner Writes The Messages Viewport Scroll Position

Exactly one module MUST own writes to the messages viewport scroll position
(`useMessagesScrollOwner`). Stick-to-bottom state, thread-open initial landing,
and post-completion restoration MUST all be decided by that owner. No other
effect, component, or hook MAY write `scrollTop` (or call a scroll-into-view that
moves the viewport) for the messages list; other code MAY only read the position
or request a change through the owner's interface.

#### Scenario: no competing writer

- **WHEN** the conversation is streaming, opening, or completing a reply
- **THEN** only `useMessagesScrollOwner` writes the messages viewport scroll
  position
- **AND** the timeline completion effect performs a remeasure only and never
  writes `scrollTop`

#### Scenario: consumers cooperate through the owner

- **WHEN** another feature needs to move the viewport (e.g. a jump control)
- **THEN** it MUST go through the owner's interface (re-arm stick / request
  follow / release stick) rather than writing scroll position directly

### Requirement: Stick-To-Bottom Follows Only When The User Is At The Bottom

The owner MUST auto-follow new streamed content only while the user is parked at
the bottom of the conversation. A manual scroll up MUST release follow; scrolling
back to the bottom MUST re-arm it. Following MUST use instant scroll during
streaming so it does not compete with input events.

#### Scenario: follow while parked at the bottom

- **WHEN** the user is at the bottom and new content streams in
- **THEN** the viewport MUST stay pinned to the newest content

#### Scenario: manual scroll-up releases follow

- **WHEN** the user scrolls up during streaming
- **THEN** the owner MUST stop auto-following
- **AND** scrolling back to the bottom MUST re-arm auto-follow

### Requirement: Thread Open Lands At The Latest Message Once

On opening a conversation scope, the owner MUST land the viewport at the latest
message exactly once per scope, and MUST mark the scope as pinned before applying
the working / pending-jump guard so that a busy or jump-targeted thread is not
re-pinned later. If a message jump is pending for the scope, the owner MUST NOT
bottom-pin (the jump owns the landing); if the thread is working, the owner MUST
defer to live follow.

#### Scenario: open an idle thread

- **WHEN** a conversation scope opens with rendered history and no pending jump
- **THEN** the viewport MUST land at the latest message
- **AND** the scope MUST be marked pinned so it is not re-pinned on later commits

#### Scenario: open a thread with a pending jump

- **WHEN** a conversation scope opens with a pending message jump
- **THEN** the owner MUST NOT bottom-pin
- **AND** the scope MUST still be marked so the initial pin does not fire later

### Requirement: The Completion Transition Window Preserves Reading Position

The owner MUST handle reply completion (`isThinking` transitioning to `false`) in
an explicit transition window, because the virtualizer swaps capped row-height
estimates for real heights and changes total scroll height. Within that window
(settle plus two animation frames) the owner MUST re-pin to the bottom if the
user was near the bottom, otherwise restore the prior reading position by height
delta so the viewport does not jump, reusing the existing viewport
snapshot/restore helpers.

#### Scenario: reading scrolled-up when a reply ends

- **WHEN** the user is scrolled up reading history and a reply completes
- **THEN** the owner MUST restore the prior reading position by height delta
- **AND** the viewport MUST NOT jump to the top or bottom

#### Scenario: parked at the bottom when a reply ends

- **WHEN** the user is parked at the bottom and a reply completes
- **THEN** the owner MUST re-pin to the bottom after the remeasure
