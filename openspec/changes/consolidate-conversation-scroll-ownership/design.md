## Context

Three effects wrote the messages viewport scroll position independently. The
felt bug was "the conversation jumps to the top when a reply finishes": the
`MessagesTimeline` completion effect grew total height (capped 260px row
estimates → real heights) and re-pinned only on scope reset, pushing the viewport
up; meanwhile the `Messages.tsx` auto-follow and initial-pin effects had their own
opinions about where the viewport should be. With no single owner, each fix
touched two or three call sites and regressions reopened.

## Goals / Non-Goals

- **Goal:** one owner, one invariant — "only `useMessagesScrollOwner` writes the
  messages viewport scroll position."
- **Goal:** an explicit completion transition window that distinguishes
  "was-at-bottom → re-pin" from "was-reading → restore by delta."
- **Non-Goal:** changing the virtualizer's estimate/remeasure behavior, or adding
  user-facing controls (separate change).

## Decisions

### Decision: A dedicated hook owns scroll, effects delegate

`useMessagesScrollOwner` holds the refs that used to be scattered across
`Messages.tsx` (`autoScrollRef`, `initialBottomPinScopeRef`) plus the transition
bookkeeping. The old auto-follow effect and initial-pin layout effect are
deleted; the timeline completion effect is reduced to a pure remeasure.

- **Why:** a single source of truth is the only way to keep "who moved the
  viewport?" answerable. Coordination flags across three effects were tried in
  spirit by the prior code and are exactly what failed.
- **Initial-pin ordering:** the owner marks the scope *before* the working /
  pending-jump guard, matching the upstream refinement that split the
  `initialBottomPinScopeRef` assignment out of the guard — a busy or
  jump-targeted thread is marked (so it will not re-pin later) but not pinned now.

### Decision: Own the completion transition window (settle + 2 rAF)

On the `isThinking → false` commit the owner opens a transition window: it waits
for layout to settle and two animation frames, reads whether the user was near
the bottom, then re-pins or restores by height delta. Restoration reuses the
existing `messagesViewModel` snapshot/restore utilities rather than new math.

- **Why:** the height change is asynchronous (real heights land over a couple of
  frames); a synchronous re-pin races the remeasure. The window makes the
  decision once, after heights stabilize.
- **Ceiling (ponytail):** the window is a fixed settle + 2 rAF. If very late row
  measurements still drift the viewport on pathological threads, the upgrade path
  is to re-pin until `scrollHeight` stabilizes (bounded) rather than widening the
  fixed wait.

### Decision: Re-assert CSS anchor/visibility specificity

The browser's `overflow-anchor` and `content-visibility` can independently move
the viewport during height changes. The messages list re-asserts specificity on
those properties so the owner's decision is not fought by the UA.

## Risks / Trade-offs

- **Streaming-follow now fires per completion commit** (previously throttled).
  Watch: if fast streams stutter, coalesce the follow via rAF or key it on
  `scrollKey`. Flagged, not currently observed.
- **Runtime-only verification:** scroll behavior cannot be fully proven by unit
  tests; the hook test covers the decision logic, but the felt behavior (no
  jump-to-top on completion, follow/release, thread-open landing) requires a real
  build. This change was authored during a git freeze, so the in-app smoke test
  is recorded as a pending manual gate (verification.md) to run on the next
  rebuild, alongside `cargo`-free JS gates which pass now.

## Migration

No data or API migration. The three deleted/gutted effects have no external
consumers; the owner is internal to `src/features/messages`.
