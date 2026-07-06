# Verification — consolidate-conversation-scroll-ownership

## Automated (pass now)

- [x] `npm run typecheck` — clean (no TypeScript errors).
- [x] `npx vitest run src/features/messages/hooks/useMessagesScrollOwner.test.ts`
  — 7/7 passing (stick follow/release, thread-open pin ±pending-jump, completion
  window re-pin vs restore-by-delta).
- [x] Static invariant check: no `scrollTop` writes to the messages viewport
  outside `useMessagesScrollOwner` (timeline completion effect is remeasure-only).

## Manual — DEFERRED to next rebuild (authored during git freeze)

Local builds are frozen for the git restructure; run these on the next rebuild:

- [ ] Open a thread with long history → viewport lands at the latest message, no
  later bounce to the top.
- [ ] Stream a reply while parked at the bottom → content auto-follows.
- [ ] Scroll up mid-stream → follow releases; scroll back to the bottom → follow
  re-arms.
- [ ] Scroll up and read history while a reply is streaming, let it finish → the
  viewport keeps the reading position (this is the "jumps to top when a reply
  ends" regression; must not recur).
- [ ] Reply finishes while parked at the bottom → viewport stays pinned.

## Notes

- This change is the foundation for `add-conversation-viewport-jump-controls`
  (jump buttons route through this owner's `setStick` / `requestFollow`).
- Watch item: streaming-follow now fires per completion commit (was throttled).
  If fast streams stutter, coalesce via rAF or key on `scrollKey`.
