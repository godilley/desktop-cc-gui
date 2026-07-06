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
  `revealAllHistoryItems("manual")` + guarded top). Inner chevrons step ±1 from the
  anchor nearest the active-anchor pivot line (resolved in the throttled scroll
  handler, with a bottom-edge correction) via `requestScrollToAnchor`. Gating the
  cluster on `hasAnchorRail` also makes the rail respect `showMessageAnchors` (was
  previously ignored) — a minor consistency improvement.
- Layout note: the cluster and dashes center on the rail midline; each chevron box
  is 20px = glyph size (no overflow) so the glyph sits on the pixel grid — fixes
  the earlier left-shift + asymmetric-arm sub-pixel rendering.

## Manual QA / 人工验证 (George-verified 2026-07-06, dev:hot on resync)

- [x] Outer-up reveals collapsed history and lands on the first message; outer-down
  snaps to the newest message and keeps following (stick re-armed).
- [x] Inner-up / inner-down step to the previous / next message anchor; correct at
  the very bottom (no skipped message) and a small scroll offset no longer makes
  "next" re-select the current message; disabled at the ends.
- [x] Hover grouping reads as single (inner) vs double (outer) chevron.
- [x] The two stacked single chevrons read as a tight double chevron.
- [x] Chevrons centered on the dash line, symmetric arms, at the desired size.
- [x] Cluster shows only with ≥2 anchors; the anchor rail's collapse/expand and
  outline flyout still work; nothing overlaps the composer.
