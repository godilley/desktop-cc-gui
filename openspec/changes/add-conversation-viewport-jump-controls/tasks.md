## 1. OpenSpec Artifacts

- [ ] 1.1 Create proposal/design/spec delta/tasks for conversation viewport jump controls; output: change artifacts under `openspec/changes/add-conversation-viewport-jump-controls`; validation: `openspec validate add-conversation-viewport-jump-controls --strict --no-interactive`. [P0][I][O: change dir][V: openspec validate]

## 2. Component

- [ ] 2.1 Add `src/features/messages/components/MessagesViewportJumpControls.tsx`: a presentational control rendering two `<button>`s (jump-to-start, jump-to-latest) styled after `MessagesOutlineFloater`; props = `{ canJumpToStart: boolean; canJumpToLatest: boolean; onJumpToStart: () => void; onJumpToLatest: () => void; labels }`; each button has a descriptive `aria-label`; render nothing when both `canJump*` are false. Output: reusable control component. Validation: focused test 3.1. [P0][depends: 1.1][I][O: MessagesViewportJumpControls.tsx][V: vitest]

## 3. Wiring (Messages.tsx)

- [ ] 3.1 Add `handleJumpToLatest` in `Messages.tsx`: call `scrollOwner.setStick(true)` then scroll the bottom sentinel into view (`bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" })`) / `scrollOwner.requestFollow()`. Output: latest-jump handler that re-arms follow. Validation: focused test asserts `setStick(true)` + scroll called. [P0][depends: 2.1][I][O: Messages.tsx][V: vitest]
- [ ] 3.2 Add `handleJumpToStart` in `Messages.tsx`: call `revealAllHistoryItems("manual")`; when `showAllHistoryItems` is already true (no transition), also directly `scrollOwner.setStick(false)` and set `containerRef.current.scrollTop = 0` so the action is never a silent no-op. Output: start-jump handler that reveals history + lands at top. Validation: focused test asserts reveal + no-op-guard path. [P0][depends: 2.1][I][O: Messages.tsx][V: vitest]
- [ ] 3.3 Derive `canJumpToStart` / `canJumpToLatest` from live scroll state (container scrollable; not at top; not stuck-to-bottom) reusing the existing throttled scroll path (`updateAutoScroll`) — do NOT measure geometry on every streamed token. Mount `MessagesViewportJumpControls` inside `.messages-shell` (`Messages.tsx:2178`, sibling of `MessagesAnchorRail`) wired to the two handlers. Output: controls appear/hide correctly and are mounted. Validation: focused test + manual. [P0][depends: 3.1, 3.2][I][O: Messages.tsx][V: vitest + manual]

## 4. i18n & CSS

- [ ] 4.1 Add i18n keys `messages.jumpToStart`, `messages.jumpToLatest` (+ `aria-label` variants if separate) to `src/i18n/locales/en.part2.ts` and any locales the i18n gate requires. Output: no missing-key warnings. Validation: `npm run typecheck` + i18n check. [P0][depends: 2.1][I][O: en.part2.ts][V: typecheck]
- [ ] 4.2 Add scoped CSS for the controls (corner placement within `.messages-shell`, matching the outline floater's visual language; respect `.has-anchor-rail` layout). Output: controls visually consistent, not overlapping the anchor rail or composer. Validation: manual. [P1][depends: 2.1][I][O: messages CSS][V: manual]

## 5. Verification

- [ ] 5.1 Add a focused Vitest test for `MessagesViewportJumpControls` (renders both buttons, hides when both `canJump*` false, click fires the right handler) and, if practical, a handler test asserting jump-to-latest re-arms stick and jump-to-start reveals history. Output: green focused test. Validation: `npx vitest run <file>`. [P0][depends: 3.3][I][O: test file][V: vitest]
- [ ] 5.2 Run repository gates; output: no TypeScript regressions. Validation: `npm run typecheck`. [P0][depends: 5.1][V: typecheck]
