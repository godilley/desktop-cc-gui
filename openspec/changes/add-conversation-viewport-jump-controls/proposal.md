## Why

Long conversations have no fast way to reach the very top (the start of the
thread) or snap back to the latest message once the user has scrolled up. The
anchor rail (`MessagesAnchorRail`) only jumps between user-message anchors, and
the live-tail window collapses older history while streaming, so "scroll up
manually" does not even reach the true start without first revealing collapsed
history. Users field-testing the build asked for simple jump-to-start /
jump-to-latest controls. All the primitives already exist
(`revealAllHistoryItems`, the scroll container ref, the bottom sentinel, and the
new `useMessagesScrollOwner` stick-to-bottom owner) — this change only surfaces
them as two buttons.

## 目标与边界

- Add two viewport-jump controls on the messages surface: **Jump to start**
  (top of the full conversation) and **Jump to latest** (bottom, re-arming
  stick-to-bottom).
- Route both through the existing scroll owner so they never fight
  `useMessagesScrollOwner`: jump-to-start releases stick, jump-to-latest re-arms
  it.
- Reveal collapsed history when jumping to start so the user lands on the true
  first message, not the top of the trimmed live-tail window.
- Match the visual/interaction pattern of `MessagesOutlineFloater`.

## 非目标

- Do not change the anchor rail, the outline floater, or per-message anchor
  jumping.
- Do not add smooth-scroll animation requirements (respect the existing instant
  vs smooth conventions; streaming stays instant).
- Do not add settings/toggles for the controls.
- Do not alter the scroll owner's transition-window / pin logic.

## What Changes

- New component `MessagesViewportJumpControls` mounted inside `.messages-shell`.
- **Jump to latest**: scroll the container to the bottom sentinel, then re-arm
  the scroll owner (`setStick(true)` + `requestFollow()`).
- **Jump to start**: reveal all collapsed history and land the viewport at the
  top, releasing stick (`revealAllHistoryItems("manual")`, with a direct
  `scrollTop = 0` + `setStick(false)` fallback when history is already fully
  shown so the action is not a no-op).
- Each control is presence-gated on the container being scrollable and hidden at
  its own extreme (at top → hide jump-to-start; stuck to bottom → hide
  jump-to-latest).
- New i18n labels + accessible `aria-label`s; new scoped CSS.

## Capabilities

### New Capabilities

- `conversation-viewport-jump-controls`: viewport jump-to-start / jump-to-latest
  controls that reuse the scroll owner and history-reveal primitives.

### Modified Capabilities

- None.

## Impact

- Frontend: new `src/features/messages/components/MessagesViewportJumpControls.tsx`
  (+ focused test), a small mount + handler wiring in
  `src/features/messages/components/Messages.tsx`, i18n entries in
  `src/i18n/locales/en.part2.ts` (+ other locales as required by the i18n gate),
  and messages CSS.
- Runtime/API: no Tauri command, IPC, storage, or Rust change.
- Dependencies: no new dependency.

## 技术方案对比

| 选项 | 做法 | 取舍 |
|---|---|---|
| Recommended: reuse scroll-owner + reveal primitives | New control calls `revealAllHistoryItems("manual")` and `scrollOwner.setStick/requestFollow`; no new scroll logic | Smallest diff; guarantees the buttons cooperate with the single scroll owner; consistent with the just-landed scroll-ownership consolidation | 
| Alternative: buttons write `scrollTop` directly | Set `scrollTop = 0` / `scrollHeight` in the handlers without touching the owner | Fewer indirections, but the owner's stick-to-bottom truth goes stale → jump-to-latest gets yanked back or jump-to-start re-pins; reintroduces the multi-owner bug the scroll-owner change removed |

## 验收标准

- Jump to latest snaps to the newest message and *keeps* following new content
  (stick re-armed); works both mid-scroll and after a manual scroll-up.
- Jump to start reveals collapsed history and lands on the first message; the
  viewport does not bounce back down.
- On a short thread with no scrollback, controls are hidden or inert (no error).
- Controls are keyboard-focusable with descriptive `aria-label`s.
- Focused component test, `npm run typecheck`, and `openspec validate
  add-conversation-viewport-jump-controls --strict --no-interactive` pass.
