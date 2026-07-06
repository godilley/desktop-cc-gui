## Context

The messages surface renders `.messages-shell` (`Messages.tsx:2178`) containing
`MessagesAnchorRail` and the scroll container `.messages` (`containerRef`,
`Messages.tsx:2189`). Scroll ownership was just consolidated into
`useMessagesScrollOwner` (`src/features/messages/hooks/useMessagesScrollOwner.ts`),
which holds the single `stickToBottom` truth and exposes
`setStick(stick)` / `requestFollow()` / `notifyUserScroll()`. History is trimmed
by a live-tail window; `revealAllHistoryItems(mode)` (`Messages.tsx:1763`) reveals
all items, and its `useLayoutEffect` (`:1771`) already does `setStick(false)` +
`scrollTop = 0` for `mode === "manual"`. The bottom sentinel is `bottomRef`;
The controls are a chevron cluster built around the anchor rail (v2), not a
separate corner floater (v1, superseded).

## Goals / Non-Goals

**Goals:**

- Surface jump-to-start and jump-to-latest without adding a second scroll owner.
- Land jump-to-start on the true first message (reveal collapsed history first).
- Keep jump-to-latest sticky (re-arm follow), matching chat convention.

**Non-Goals:**

- No changes to anchor-rail / outline-floater / scroll-owner internals.
- No new scroll geometry math — reuse existing primitives only.

## Decisions

1. Route all scroll writes through the scroll owner.
   - Option A (chosen): handlers call `revealAllHistoryItems("manual")` and
     `scrollOwner.setStick/requestFollow`; the owner keeps a coherent
     stick-to-bottom truth.
   - Option B: handlers set `scrollTop` directly.
   - Trade-off: B is shorter but desynchronizes the owner and reintroduces the
     end-of-stream jump/yank class the owner was built to remove.

2. Jump-to-start reuses the existing manual-reveal path, with a no-op guard.
   - `revealAllHistoryItems("manual")` triggers the reveal + `scrollTop = 0`
     layout effect only when `showAllHistoryItems` actually transitions to true.
   - When history is already fully shown (short thread, or already expanded),
     the handler MUST directly `setStick(false)` and set `scrollTop = 0` so the
     button is never a silent no-op.

3. Jump-to-latest re-arms stick then scrolls.
   - `setStick(true)` first, then `bottomRef.current?.scrollIntoView({ behavior:
     "instant", block: "end" })` (or `requestFollow()`), so subsequent streamed
     content keeps following.

4. Presence gating is derived from live scroll state, not new global state.
   - Outer chevrons: compute "is scrollable / at top / at bottom" from
     `containerRef` in the existing throttled scroll handler (`updateAutoScroll`);
     disable each at its own extreme. Keep it cheap — no per-frame layout thrash.
   - Inner chevrons: derive `canPrev` / `canNext` from `activeAnchorId` +
     `messageAnchors` in render (anchor-state driven, not per streamed token).

5. Rail-integrated cluster (v2), superseding the v1 corner floater.
   - `MessagesViewportJumpControls` wraps `MessagesAnchorRail` as `children`: an
     up-group above, a down-group below. It takes over the rail's absolute slot
     (`right:50px`); the rail flows inside as `position:relative` so its outline
     flyout still anchors to it. The whole cluster is shown only when the rail is
     (≥2 anchors, `hasAnchorRail`).

6. Inner chevrons step to the previous / next message anchor (the rail's points).
   - The "current" anchor is the one nearest the active-anchor pivot line
     (`scrollTop + min(96, clientHeight*0.32)`), resolved in the throttled scroll
     handler; step ±1 from it via `requestScrollToAnchor` (which releases stick);
     disabled when there is no anchor in that direction. A bottom-edge correction
     forces "current" to the last anchor when scrolled to the bottom.
   - Chosen over "every message" (no new target list) and over two rejected
     variants: index-from-`activeAnchorId` (the near-top heuristic never reaches
     the last message → "up" at the bottom skipped one), and a raw
     `scrollTop`-threshold scan (a small offset made "next" re-select the current
     message). Nearest-to-pivot is stable against small scroll offsets.

7. Pure-CSS hover grouping for the single-vs-double affordance.
   - DOM order per group is `[outer][inner]`; `.outer:hover ~ .inner` lights the
     inner too (both lit = a double chevron), while `.inner:hover` — which cannot
     select the preceding outer — lights only itself. `:focus-visible` mirrors
     hover for keyboard parity. Chosen over rendering a third (double) icon or a
     JS hover-state so we get the conventional next/last iconography from two
     single chevrons.

## Risks / Trade-offs

- [Risk] The reveal-all path can be expensive on very long threads (mounts full
  history).
  - Mitigation: it is user-initiated and identical to the existing "show all
    history" behavior; no new cost class.
- [Risk] Presence-gating that reads geometry every scroll could add scroll-handler
  work during streaming.
  - Mitigation: reuse the existing throttled scroll path; store booleans in a ref
    / low-frequency state; do not measure on every streamed token.
- [Risk] A handler that bypasses the scroll owner would resurrect the multi-owner
  jump bug.
  - Mitigation: Decision 1 forbids direct `scrollTop` writes except the guarded
    jump-to-start `scrollTop = 0` fallback, which also sets stick false.

## Migration Plan

1. Author OpenSpec proposal / design / spec delta / tasks.
2. Add `MessagesViewportJumpControls` + wire handlers/mount in `Messages.tsx`.
3. Add i18n + CSS; add a focused component test.
4. Run focused test, `npm run typecheck`, `openspec validate --strict`.
5. Rollback restores the touched files; no runtime-state migration.

## Open Questions

- Exact placement (corner) and whether to share a container with the outline
  floater — deferred to implementation, constrained only by "match
  `MessagesOutlineFloater` pattern".
