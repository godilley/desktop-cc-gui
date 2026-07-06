# conversation-viewport-jump-controls Specification Delta

## ADDED Requirements

### Requirement: Navigation Cluster Is Positioned Around The Anchor Rail

The conversation navigation controls MUST be presented as a vertical cluster
built around the message anchor rail: outer + inner chevron controls stacked
above the rail and mirrored below it. The cluster MUST be shown only when the
anchor rail is shown (two or more message anchors), and MUST NOT break the anchor
rail's own collapse/expand or its outline flyout.

#### Scenario: cluster appears with the anchor rail

- **WHEN** the conversation has two or more message anchors (the anchor rail is
  shown)
- **THEN** the navigation cluster MUST render its chevron controls above and
  below the rail
- **AND** the anchor rail's dash ruler, hover-expand outline, and flyout
  positioning MUST continue to work unchanged

#### Scenario: cluster hidden on short conversations

- **WHEN** the conversation has fewer than two message anchors
- **THEN** neither the rail nor the chevron controls are shown

### Requirement: Outer Chevrons Jump To Conversation Extremes

The outer (rail-distal) chevrons MUST jump to the conversation extremes: the
top outer chevron to the first message, the bottom outer chevron to the latest
message. Jump-to-first MUST reveal any collapsed history and land on the true
first message; jump-to-latest MUST re-arm stick-to-bottom so streamed content
keeps following. Both MUST cooperate with the single scroll owner
(`useMessagesScrollOwner`) and MUST NOT introduce a competing scroll owner.

#### Scenario: outer-down jumps to latest and re-arms follow

- **WHEN** the user has scrolled up and activates the bottom outer chevron
- **THEN** the viewport MUST move to the newest message
- **AND** stick-to-bottom MUST be re-armed so new streamed content auto-follows

#### Scenario: outer-up reveals history and lands at the top

- **WHEN** older history is collapsed and the user activates the top outer
  chevron
- **THEN** collapsed history MUST be revealed and the viewport MUST land on the
  first message, releasing stick-to-bottom, and never be a silent no-op

### Requirement: Inner Chevrons Step Through Message Anchors

The inner (rail-proximal) chevrons MUST step one message anchor at a time
relative to the active anchor: the top inner chevron to the previous anchor, the
bottom inner chevron to the next anchor, reusing the existing anchor list, active
anchor, and anchor-scroll primitive. An inner chevron MUST be disabled when no
anchor exists in its direction.

#### Scenario: step to the previous / next anchor

- **WHEN** an anchor is active and the user activates the top inner chevron
- **THEN** the viewport MUST scroll to the immediately previous message anchor
- **WHEN** the user activates the bottom inner chevron
- **THEN** the viewport MUST scroll to the immediately next message anchor

#### Scenario: inner chevron disabled at the ends

- **WHEN** the active anchor is the first anchor
- **THEN** the top inner chevron MUST be disabled
- **WHEN** the active anchor is the last anchor
- **THEN** the bottom inner chevron MUST be disabled

### Requirement: Hover Grouping Conveys Step-vs-Jump Without A Third Icon

Hovering an outer chevron MUST visually highlight both chevrons on that side, so
the pair reads as a double chevron (jump), while hovering an inner chevron MUST
highlight only itself (step) — conveying the conventional single-vs-double
affordance without rendering a third icon. The grouping MUST be presentation-only
and MUST NOT be required to operate the controls.

#### Scenario: hovering outer highlights both

- **WHEN** the pointer hovers an outer chevron
- **THEN** both chevrons on that side MUST appear highlighted

#### Scenario: hovering inner highlights only itself

- **WHEN** the pointer hovers an inner chevron
- **THEN** only that inner chevron MUST appear highlighted

### Requirement: Navigation Controls Are Accessible

Each chevron MUST be a keyboard-focusable button with a distinct, descriptive
`aria-label` (jump to start, previous message, next message, jump to latest). The
hover-grouping affordance is presentation only and MUST NOT be required for
keyboard or screen-reader operation.

#### Scenario: keyboard and screen-reader operation

- **WHEN** a user navigates the controls by keyboard or screen reader
- **THEN** each chevron MUST expose its own descriptive label and be operable
  without relying on hover state
