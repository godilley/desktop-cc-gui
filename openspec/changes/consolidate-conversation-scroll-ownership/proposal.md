## Why

The messages surface had **three independent pieces of code writing scroll
position**: a `Messages.tsx` auto-follow effect (stick-to-bottom during
streaming), a `Messages.tsx` initial-pin layout effect (land at the bottom when a
thread opens), and a `MessagesTimeline.tsx` completion effect that re-pinned to
the bottom after a remeasure. Because the virtualizer starts rows on capped
height estimates and swaps in real heights on completion, these owners fought each
other: the completion remeasure grew total height and one owner would yank the
viewport (the "scrolls to top when a reply ends" jump), while another re-pinned —
a race with no single source of truth. There was no invariant to reason about,
so every scroll bug reopened two or three call sites.

## 目标与边界

- Establish a **single scroll owner** for the messages viewport: exactly one
  place decides stick-to-bottom, thread-open landing, and post-completion
  restoration.
- Own the **completion transition window** explicitly (`isThinking` → `false`):
  wait for the layout to settle, then either re-pin (if the user was parked at the
  bottom) or restore by height delta (if they were reading scrolled-up), instead
  of unconditionally re-pinning.
- Reuse the existing viewport snapshot/restore helpers rather than inventing new
  scroll math.
- Preserve existing behavior: streaming stays instant-scroll; a manual scroll-up
  still releases follow; opening a thread still lands at the latest message.

## 非目标

- Do not change the anchor rail, the outline floater, or per-message anchor jumps.
- Do not add new user-facing controls (jump buttons are a **separate** change,
  `add-conversation-viewport-jump-controls`, which builds on this owner).
- Do not alter the virtualizer's estimate/remeasure logic itself — only stop the
  completion effect from writing `scrollTop`.
- No Tauri/IPC/storage/Rust change.

## What Changes

- New `src/features/messages/hooks/useMessagesScrollOwner.ts`: the sole scroll
  owner. Tracks stick-to-bottom, the initial-pin scope, and an owned transition
  window opened on the `isThinking → false` commit (settle + 2 rAF); pins to the
  bottom sentinel when the user was near the bottom, otherwise restores the prior
  read position by height delta. Exposes `setStick` / `requestFollow` so future
  consumers cooperate instead of writing `scrollTop`.
- `Messages.tsx`: **remove** the auto-follow effect and the initial-pin layout
  effect; delegate both to the owner.
- `MessagesTimeline.tsx`: the completion effect is **gutted to remeasure-only** —
  it swaps capped estimates for real heights (the virtualizer's legitimate job)
  and MUST never write `scrollTop`.
- CSS: re-assert `overflow-anchor` / `content-visibility` specificity on the
  messages list so the browser's own anchor logic does not fight the owner.
- Focused hook test (7 scenarios) covering pin, restore, and the transition
  window.

## Capabilities

### New Capabilities

- `conversation-scroll-ownership`: a single-owner invariant for the messages
  viewport — one hook owns stick-to-bottom, thread-open landing, and the
  completion transition window; no other code writes viewport scroll position.

### Modified Capabilities

- None. (Existing scroll-restoration specs are unaffected; this change removes
  competing owners without changing their observable contract.)

## Impact

- Frontend only: new `useMessagesScrollOwner.ts` (+ test), edits to
  `Messages.tsx` (−auto-follow, −initial-pin) and `MessagesTimeline.tsx`
  (remeasure-only), and specificity re-asserts in `messages.part1.css` /
  `messages.part1-shell.css`.
- Runtime/API: none. Dependencies: none.

## 技术方案对比

| 选项 | 做法 | 取舍 |
|---|---|---|
| Recommended: one hook owns all viewport scroll | Consolidate the three writers into `useMessagesScrollOwner`; other effects may only read or ask the owner (`setStick`/`requestFollow`) | A single invariant to reason about; kills the completion-remeasure race; makes future consumers (jump controls) safe by construction | 
| Alternative: keep the three effects, add coordination flags | Guard each existing writer with shared "who's driving" refs | Smaller immediate diff, but the multi-owner race stays latent — every new scroll feature has to thread the flags correctly; this is what caused the reopening bugs |

## 验收标准

- Opening a thread lands the viewport at the latest message (initial pin) without
  a later bounce.
- During streaming, content auto-follows only while the user is parked at the
  bottom; a manual scroll-up releases follow and scrolling back down re-arms it.
- When a reply ends, a user who was reading scrolled-up keeps their position (no
  jump to top); a user parked at the bottom stays pinned.
- No code outside the owner writes `scrollTop` for the messages viewport.
- Focused hook test, `npm run typecheck`, and `openspec validate
  consolidate-conversation-scroll-ownership --strict --no-interactive` pass.
