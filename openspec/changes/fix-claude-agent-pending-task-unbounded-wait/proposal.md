## Why

When a turn spawns a background Agent/Task subagent, the wait that precedes the turn's own `result`
event has no timeout at all. If that subagent crashes or hangs without ever emitting a terminal
`task_notification`, the turn blocks indefinitely and the UI stays in "generating" forever, with no
automatic recovery path.

The mechanism is specific, and worth stating precisely because the obvious diagnosis is wrong:

- The CLI **defers** the current turn's `result` event until every pending background Agent/Task
  subagent has settled, then emits them together. The observed order is constant: `task_started` ->
  `task_notification` -> the turn's `result`.
- `claude.rs`'s `CLAUDE_POST_RESULT_GRACE` grace-kill only arms once `result_seen_at.is_some()`
  (via `post_result_grace_deadline`'s `get_or_insert_with`). Because of the deferral above, that
  precondition is never true while a background task is pending, so no post-result mechanism engages
  for this case at all.
- The reachable gap is therefore in the other branch: while `result_seen_at` is `None`
  (`saw_valid_stream_event` already true, `result` not yet seen), the wait falls through to a bare
  `lines.next_line().await` around `claude.rs:1868-1869` with no timeout protection.

This was established by three in-app reproductions on a confirmed pre-fix binary, running a real
single-command background subagent with no `sleep`: the three runs took 112s, 37.5s and 502s and
**all three delivered successfully, never killed**. A `ps -eo pid,ppid,lstart,cmd` snapshot taken
before and after the third run showed an identical PID and start time across 510 seconds, proving
the process was never killed and never restarted. The raw stream captures confirm the deferral
order above. Details in `design.md`.

## Goals and Scope

- Bound only the reachable gap: the wait while `result_seen_at` is `None` **and** a background
  Agent/Task subagent is pending, using `CLAUDE_BG_TASK_MAX_WAIT`.
- Track that pending state in a set that is **independent of** `active_background_task_ids` (the
  existing set that serves only the post-result `WaitBgTasks` path, issue #983), so the two waits
  cannot affect one another.
- Leave `active_background_task_ids` and the post-result `WaitBgTasks` path completely unchanged,
  preserving #983's deliberately unbounded behavior.
- When no background task is pending, this wait loop keeps its current behavior (genuinely
  unbounded, no new timeout). A slow but healthy long turn with no background task is unaffected.
- Claude Local CLI engine path only.

## Non-Goals

- No PreToolUse deny mechanism.
- No change to #983's own proposal, design, spec, or behavior.
- No dedicated "waiting for agent" UI copy (a pre-existing P1 item, still deferred).
- No re-derivation of the `CLAUDE_BG_TASK_MAX_WAIT` value itself. The existing 30-minute production
  value is reused unchanged; only the place it is applied is new.

## What Changes

- `claude_stream_helpers.rs`: `extract_task_started_id` (symmetric with the existing release logic,
  recognising `task_started` events) is wired to a **new, independent** pending-task set and
  deadline rather than to `active_background_task_ids`.
- `claude.rs`:
  - In the `result_seen_at.is_none()` branch (around `claude.rs:1868-1869`), wrap the wait in
    `tokio::time::timeout` whenever the new pending set is non-empty. On expiry, converge via the
    existing `settled_by_grace = true; break;` path, reusing the established force-kill mechanism
    rather than introducing a new failure mode.
  - The deadline is an **idle** bound, not an absolute one: it resets on every stream event received
    while the task is pending, so a genuinely active long-running subagent is not killed.
  - When force-kill does fire and `response_text` is empty, write a visible
    `settled_by_pending_task_max_wait` notice rather than reporting a silent empty success.
  - With no pending task, the branch keeps its current bare `next_line().await`.
- Tests: fake-stream coverage for (a) `task_started` with no terminal notification and no `result`,
  converging at the bound; (b) `task_started` plus a terminal notification arriving before `result`
  in the real observed order, not triggering the bound; (c) a normal long turn with no background
  task, unaffected; (d) the existing #983 Bash-path regressions staying green with `WaitBgTasks`
  still unbounded; (e) an idle-reset case proving the bound is idle-based rather than absolute.

### Alternatives considered

| Option | Description | Trade-off |
|------|------|------|
| A. Extend the #983 register side and bound the post-result wait | Bound the wait that fires after `result` | **Rejected**: the reproductions above show the post-result path is never armed while a background task is pending, so this is dead code on the happy path, and it regresses #983 by bounding a wait that was deliberately unbounded |
| B. Reuse the `active_background_task_ids` set for the pre-result branch too | Saves introducing a new set | **Rejected**: couples two independent wait semantics onto one set, so a future change to either path can silently affect the other |
| C. Bound every pre-result wait unconditionally | No pending-task condition | **Rejected**: kills legitimate slow turns with no background task involved (long model reasoning or output), which is not the risk being addressed |
| **D (adopted). Independent pending tracking, bound only the pre-result branch** | A dedicated set and deadline serving this branch only; post-result `WaitBgTasks` untouched | **Adopted**: targets the reachable gap precisely, introduces no coupling or regression, and is small (one set plus one timeout branch) while reusing the existing force-kill convergence path |

## Capabilities

### New Capabilities

- `claude-agent-pending-task-liveness-bound`: the bounded-wait contract for the window where
  `result_seen_at` is `None` and a pending Agent/Task `task_started` exists. It sits alongside
  #983's `claude-background-task-settlement` (post-result `WaitBgTasks`) and does not modify it.

### Modified Capabilities

None.

## Impact

| Layer | Effect |
|----|--------|
| Backend | `claude_stream_helpers.rs` (reuse `extract_task_started_id`, wired to the new set); `claude.rs` (new bounded pre-result wait branch) |
| Frontend | No expected change |
| Specs | Adds `claude-agent-pending-task-liveness-bound`; #983's own delta is untouched |
| Dependencies | Structurally depends on #983's register/release/grace mechanism, already on `main` |

## Acceptance Criteria

1. fake-stream: a `task_started` that is never followed by a terminal notification or a `result`
   still converges via force-kill at the `CLAUDE_BG_TASK_MAX_WAIT` bound instead of blocking
   indefinitely.
2. fake-stream: `task_started` plus a matching terminal notification before `result` (the real
   observed order) does not trigger the bound, and the turn completes through the existing path.
3. fake-stream: a normal long turn with no background task behaves exactly as it does today.
4. fake-stream: a pending task that keeps emitting stream events past the raw bound is **not**
   killed, proving the deadline is idle-based rather than absolute.
5. The existing #983 Bash-path regressions stay green, with post-result `WaitBgTasks` still
   unbounded.
6. A force-kill with empty `response_text` produces a visible notice, not a silent empty success.
7. `openspec validate fix-claude-agent-pending-task-unbounded-wait --strict --no-interactive` passes.
