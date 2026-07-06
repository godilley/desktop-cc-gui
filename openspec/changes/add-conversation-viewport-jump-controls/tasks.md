## 1. OpenSpec Artifacts

- [x] 1.1 Author/refresh proposal/design/spec delta/tasks for the rail-integrated chevron navigation cluster; output: change artifacts under `openspec/changes/add-conversation-viewport-jump-controls`; validation: `openspec validate add-conversation-viewport-jump-controls --strict --no-interactive`. [P0][I][O: change dir][V: openspec validate]

## 2. Component

- [x] 2.1 Rework `MessagesViewportJumpControls.tsx` into a rail-integrated cluster: renders an up-group (outer=jump-to-start, inner=previous) above `children` (the anchor rail) and a down-group (inner=next, outer=jump-to-latest) below it. Props `{ canJumpToStart, canJumpToLatest, canPrev, canNext, onJumpToStart, onJumpToLatest, onPrev, onNext, labels, children }`; each chevron a `<button>` with a distinct `aria-label`, disabled when its `can*` is false; DOM order per group is outer-then-inner so the pure-CSS hover-grouping combinator works. Output: presentational cluster wrapping the rail. Validation: focused test 5.1. [P0][depends: 1.1][I][O: MessagesViewportJumpControls.tsx][V: vitest]

## 3. Wiring (Messages.tsx)

- [x] 3.1 Keep `handleJumpToLatest` / `handleJumpToStart` (unchanged scroll-owner behavior). [x already implemented] [P0][I][O: Messages.tsx][V: vitest]
- [x] 3.2 Add `handlePrevAnchor` / `handleNextAnchor`: compute the active anchor index in `messageAnchors` (fallback when `activeAnchorId` is null: prev→last, next→first), clamp, and call `requestScrollToAnchor(target.id)` (which already releases stick). Output: prev/next step handlers. Validation: manual + focused. [P0][depends: 2.1][I][O: Messages.tsx][V: manual]
- [x] 3.3 Derive `canPrev` / `canNext` from `activeAnchorId` + `messageAnchors` in render (cheap; updates on anchor state, not per streamed token). Keep `canJumpToStart` / `canJumpToLatest` from the existing throttled scroll read. Output: correct enable/disable. Validation: manual. [P0][depends: 2.1][I][O: Messages.tsx][V: manual]
- [x] 3.4 Restructure the mount: nest `<MessagesAnchorRail>` as the child of `<MessagesViewportJumpControls>`, gated on `hasAnchorRail`; remove the standalone rail + old floater mounts. Output: single cluster in `.messages-shell`. Validation: manual + typecheck. [P0][depends: 3.2, 3.3][I][O: Messages.tsx][V: typecheck]

## 4. i18n & CSS

- [x] 4.1 Add i18n keys `messages.prevMessage`, `messages.nextMessage` alongside the existing `messages.jumpToStart` / `messages.jumpToLatest` (en + zh, matching where those live). Output: no missing-key warnings. Validation: `npm run typecheck`. [P0][depends: 2.1][I][O: en.part1.ts, zh.part1.ts][V: typecheck]
- [x] 4.2 Replace the old bottom-left floater CSS with the cluster CSS: position the cluster in the rail's absolute slot (`right:50px`), make the nested rail `position:relative` (flyout preserved), stack up-group/rail/down-group, tight chevron spacing so two lit chevrons read as a double chevron, and the pure-CSS hover grouping — `.outer:hover`, `.outer:hover ~ .inner`, `.inner:hover` highlight rules (down-group uses `column-reverse` so outer sits at the bottom while staying DOM-first). Output: correct layout + hover grouping. Validation: manual. [P1][depends: 2.1][I][O: messages.status-shell.css][V: manual]

## 5. Verification

- [x] 5.1 Update the focused Vitest test for the reworked component (renders all four chevrons with distinct aria-labels + a rail child, disables each chevron when its `can*` is false, click fires the right handler, hides when the cluster is not shown). Output: green focused test. Validation: `npx vitest run <file>`. [P0][depends: 3.4][I][O: test file][V: vitest]
- [x] 5.2 Run repository gates; output: no TypeScript regressions. Validation: `npm run typecheck`. [P0][depends: 5.1][V: typecheck]
- [ ] 5.3 Manual QA (dev/prod build): outer/inner jumps behave; hover grouping (outer highlights both, inner highlights self) reads as single/double chevron; disabled states; keyboard/aria. Output: verification.md manual checklist completed. [P0][depends: 5.2][V: manual]
