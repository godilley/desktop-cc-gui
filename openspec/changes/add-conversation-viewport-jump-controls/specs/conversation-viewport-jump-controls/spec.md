# conversation-viewport-jump-controls Specification Delta

## ADDED Requirements

### Requirement: Viewport Jump Controls Are Surfaced On The Messages Surface

The messages surface MUST surface two viewport-jump controls — jump-to-start and
jump-to-latest — presence-gated on the scroll container being scrollable, and
each hidden (or inert) at its own extreme.

#### Scenario: controls appear when the conversation overflows

- **WHEN** the messages scroll container has more content than fits the viewport
- **THEN** the surface MUST render the jump-to-start and jump-to-latest controls
- **AND** each control MUST be a keyboard-focusable button with a descriptive
  `aria-label`

#### Scenario: controls are inert on a short conversation

- **WHEN** the conversation fits within the viewport (no scrollback)
- **THEN** neither control is shown, or activating a shown control is a safe
  no-op
- **AND** no error is produced

#### Scenario: each control hides at its own extreme

- **WHEN** the viewport is already at the top of the conversation
- **THEN** the jump-to-start control MUST be hidden or disabled
- **WHEN** the viewport is stuck to the bottom (following the latest message)
- **THEN** the jump-to-latest control MUST be hidden or disabled

### Requirement: Jump To Latest Re-Arms Stick-To-Bottom

Activating jump-to-latest MUST move the viewport to the newest message and
re-arm the conversation's stick-to-bottom follow through the single scroll owner,
so subsequently streamed content keeps following.

#### Scenario: jump to latest after scrolling up

- **WHEN** the user has scrolled up (stick-to-bottom released) and activates
  jump-to-latest
- **THEN** the viewport MUST move to the newest message
- **AND** the scroll owner's stick-to-bottom MUST be re-armed so new streamed
  content continues to auto-follow

### Requirement: Jump To Start Reveals Collapsed History

Activating jump-to-start MUST land the viewport on the true first message of the
conversation, revealing any collapsed / trimmed history first, and MUST release
stick-to-bottom. It MUST NOT be a silent no-op when history is already fully
shown.

#### Scenario: jump to start with trimmed history

- **WHEN** older history is collapsed by the live-tail window and the user
  activates jump-to-start
- **THEN** the surface MUST reveal all collapsed history
- **AND** land the viewport at the first message
- **AND** release stick-to-bottom so the viewport is not pulled back down

#### Scenario: jump to start when history already shown

- **WHEN** all history is already revealed and the user activates jump-to-start
- **THEN** the surface MUST still move the viewport to the top and release
  stick-to-bottom rather than doing nothing

### Requirement: Controls Cooperate With The Single Scroll Owner

The jump controls MUST route their scroll effects through the single scroll owner
(`useMessagesScrollOwner`) and MUST NOT introduce an independent scroll owner. No
control may leave the scroll owner's stick-to-bottom truth desynchronized from the
resulting viewport position.

#### Scenario: no competing scroll owner is introduced

- **WHEN** a jump control changes the viewport position
- **THEN** it MUST update the scroll owner's stick-to-bottom state to match the
  new position (released for jump-to-start, armed for jump-to-latest)
- **AND** it MUST NOT perform raw scroll writes that bypass the owner, except a
  jump-to-start `scrollTop = 0` that is accompanied by releasing stick
