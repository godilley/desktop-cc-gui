## 1. OpenSpec Artifacts

- [x] 1.1 Author proposal/design/spec delta/tasks/verification for the single-owner scroll consolidation; output: change artifacts under `openspec/changes/consolidate-conversation-scroll-ownership`; validation: `openspec validate consolidate-conversation-scroll-ownership --strict --no-interactive`. [P0][I][O: change dir][V: openspec validate]

## 2. Scroll owner hook

- [x] 2.1 Add `src/features/messages/hooks/useMessagesScrollOwner.ts`: the sole owner of messages-viewport scroll — tracks stick-to-bottom, initial-pin scope, and an owned completion transition window (`isThinking→false` → settle + 2 rAF → re-pin if near-bottom else restore by height delta, reusing `messagesViewModel` snapshot/restore). Exposes `setStick` / `requestFollow`. Output: new hook. Validation: focused test 5.1. [P0][depends: 1.1][I][O: useMessagesScrollOwner.ts][V: vitest]
- [x] 2.2 Mark the initial-pin scope before the working / pending-jump guard so a busy or jump-targeted thread is not re-pinned later (preserves upstream's `pendingJumpMessageId` ordering fix). Output: correct initial-pin ordering. Validation: focused test. [P0][depends: 2.1][I][O: useMessagesScrollOwner.ts][V: vitest]

## 3. Remove competing owners

- [x] 3.1 Delete the auto-follow effect and the initial-pin layout effect from `Messages.tsx`; wire the owner in their place. Output: `Messages.tsx` no longer writes viewport scroll directly. Validation: typecheck + manual. [P0][depends: 2.1][I][O: Messages.tsx][V: typecheck]
- [x] 3.2 Gut the `MessagesTimeline.tsx` completion effect to remeasure-only — swap capped estimates for real heights, never write `scrollTop`. Output: timeline no longer re-pins. Validation: typecheck + manual. [P0][depends: 2.1][I][O: MessagesTimeline.tsx][V: typecheck]

## 4. CSS

- [x] 4.1 Re-assert `overflow-anchor` / `content-visibility` specificity on the messages list so the UA does not fight the owner. Output: stable viewport under height changes. Validation: manual. [P1][depends: 3.2][I][O: messages.part1.css, messages.part1-shell.css][V: manual]

## 5. Verification

- [x] 5.1 Focused Vitest test (7 scenarios) for the owner: stick follow/release, thread-open pin (with and without pending jump), and the completion transition window (re-pin vs restore-by-delta). Output: green test. Validation: `npx vitest run src/features/messages/hooks/useMessagesScrollOwner.test.ts`. [P0][depends: 2.2][I][O: useMessagesScrollOwner.test.ts][V: vitest]
- [x] 5.2 Repository JS gates. Output: no TypeScript regressions. Validation: `npm run typecheck`. [P0][depends: 5.1][V: typecheck]
- [ ] 5.3 Manual QA on a real build (deferred — authored during git freeze): thread-open landing, follow/release during streaming, no jump-to-top when a scrolled-up reply ends, parked-at-bottom re-pin. Output: verification.md manual checklist completed. Validation: manual (next rebuild). [P0][depends: 5.2][V: manual]
