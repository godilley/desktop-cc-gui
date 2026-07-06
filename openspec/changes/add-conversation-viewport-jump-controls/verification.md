# Verification / 验证

## Evidence Class / 证据级别

- Component structure, handler wiring, disabled states, and a11y labels are
  `automated` (focused Vitest + typecheck).
- Spec artifact validity is `automated` (`openspec validate --strict`).
- Scroll behavior, the pure-CSS hover-grouping affordance, and the visual
  double-chevron reading are `manual-only` — jsdom cannot measure real scroll
  geometry or resolve `:hover ~` styling (WebKitGTK 2.52.4 is the renderer).

## Commands / 命令

```bash
npx vitest run src/features/messages/components/MessagesViewportJumpControls.test.tsx
npm run typecheck
openspec validate add-conversation-viewport-jump-controls --strict --no-interactive
```

## Results / 结果

- `MessagesViewportJumpControls.test.tsx`: passed (4/4) — renders all four
  chevrons with the rail slot between the up/down groups, each chevron fires only
  its own handler, a chevron is disabled (not hidden) at its extreme, and every
  chevron exposes a distinct descriptive `aria-label`.
- `npm run typecheck`: passed.
- `openspec validate ... --strict`: `Change is valid`.
- Design note: the cluster wraps the anchor rail (rail becomes `position:relative`
  inside so its outline flyout still anchors to it); scroll effects route through
  `useMessagesScrollOwner` (outer-down `setStick(true)`+`requestFollow()`, outer-up
  `revealAllHistoryItems("manual")` + guarded top); inner chevrons reuse
  `messageAnchors` + `activeAnchorId` + `requestScrollToAnchor`. Gating the cluster
  on `hasAnchorRail` also makes the rail respect `showMessageAnchors` (was
  previously ignored) — a minor consistency improvement.

## Manual QA / 人工验证 (pending — task 5.3)

Manual, dev/prod build (WebKitGTK):

- [ ] Outer-up reveals collapsed history and lands on the true first message;
  outer-down snaps to the newest message AND keeps following streamed content
  (stick re-armed), both mid-scroll and after a manual scroll-up.
- [ ] Inner-up / inner-down step to the previous / next message anchor; each
  inner chevron is disabled at its end (first/last anchor).
- [ ] Hover grouping: hovering an outer chevron highlights BOTH chevrons on that
  side (reads as a double chevron »); hovering an inner highlights only itself.
- [ ] The two stacked single chevrons read cleanly as a double chevron when both
  lit (visual spacing acceptable).
- [ ] Cluster shows only with ≥2 anchors; the anchor rail's collapse/expand and
  outline flyout still work; nothing overlaps the composer.
- [ ] Keyboard: each chevron is focusable with a descriptive label; the grouping
  affordance is not required to operate the controls.
