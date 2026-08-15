## Context

### What the CLI actually does with `result` when a background Agent/Task is pending

The intuitive model of this code path is wrong in a way that matters, so the evidence is recorded
here in full.

Three in-app reproductions were run against a confirmed pre-fix binary, each starting a background
Agent/Task subagent doing real single-command work with no artificial `sleep`:

| Run | Subagent task | Duration | Outcome |
|---|---|---|---|
| 1 | Read 43 source files and summarise | 112s | Delivered successfully |
| 2 | `find / -xdev -type f \| wc -l` | 37.5s | Delivered successfully |
| 3 | `find / -xdev -type f \| xargs md5sum \| wc -l` | 502s | Delivered successfully, PID-verified |

For run 3, `ps -eo pid,ppid,lstart,cmd` captured the handling process's PID and start time before
launch, and again in the turn triggered by `task_notification`. Both were identical across 510
seconds: the same OS process throughout, never killed and never replaced by a `--resume` restart.

Reading the raw stream captures line by line gives the decisive detail. An 80-line capture of a
single background `general-purpose` subagent:

```
L37        system/background_tasks_changed   (task registered)
L38        system/task_started task_id=a68e1c0cd56b98ac9
L39        user                              (async-launch tool result)
L44,48,49  assistant                         (turn "appears" finished here)
L50-52     background_tasks_changed[] / task_updated status=completed / task_notification completed
L71,75     assistant                         (reply to the notification)
L79        result #1  subtype=success num_turns=2 duration_ms=3643
L80        result #2  origin={"kind":"task-notification"} num_turns=1 duration_ms=3035
```

Searching that file for `"type":"result"` matches only L79 and L80: **no `result` event appears
before `task_notification`.** `result #1`'s `duration_ms=3643` also exceeds the notification's own
`usage.duration_ms=1373`, showing it was emitted at the end of the whole turn rather than at the
first assistant reply. A second capture has the identical structure (`task_started` at L38,
`task_notification` at L55, `result` only at L112/113).

**Conclusion: the CLI defers the turn's `result` until every pending background Agent task has
settled, then emits both `result` events back to back.** This is the opposite of the Bash background
shell case handled by #983, where `result` arrives normally while the shell is still running, which
is exactly why #983 needs its blocker mechanism.

### Why that makes the post-result path unreachable here

`result_seen_at` is only set when the first `type=="result"` is seen (`claude.rs:2044-2047`). Since
the turn never emits `result` early, `result_seen_at` stays `None` for the entire lifetime of the
background task. `post_result_grace_deadline`'s `get_or_insert_with` and the grace decision
(`can_force_kill_for_grace`) are therefore never reached. This is not a race that happens to be won;
the precondition simply never holds.

For that whole period the wait loop sits in the `saw_valid_stream_event == true &&
result_seen_at.is_none()` branch, which is a bare `lines.next_line().await` around
`claude.rs:1868-1869` with **no timeout wrapper at all**.

### The reachable gap

If a background subagent crashes or hangs without ever emitting its terminal `task_notification`,
the CLI will most likely never emit `result` either, since it is waiting on the same event. That
bare `next_line().await` then blocks permanently, with no automatic convergence path and the UI
stuck in "generating".

## Decision

Introduce pending-task tracking that is **independent of** `active_background_task_ids`, serving
only the pre-result branch:

- **Tracking state**: a new `pending_agent_task_ids: HashSet<String>`, structurally like
  `active_background_task_ids` but a separate variable. It reuses the existing
  `extract_task_started_id` to recognise `task_started` and `extract_terminal_task_release_id` to
  recognise terminal `task_notification`, inserting and removing respectively. Both helpers are
  symmetric and already test-covered; the only change is that they no longer write to
  `active_background_task_ids`.
- **A bounded wait that is IDLE, not absolute**: `pending_agent_task_deadline: Option<Instant>` is
  armed via `get_or_insert_with(|| Instant::now() + CLAUDE_BG_TASK_MAX_WAIT)` when
  `pending_agent_task_ids` first becomes non-empty, **and is reset to
  `Instant::now() + CLAUDE_BG_TASK_MAX_WAIT` on every successfully parsed stream event received
  while the set is non-empty**. Any event at all is evidence the process is alive and producing.
  A genuinely working subagent therefore never trips the bound however long it runs in total; only a
  full `CLAUDE_BG_TASK_MAX_WAIT` window with no new line does. While
  `saw_valid_stream_event == true && result_seen_at.is_none()` and the set is non-empty, the
  `lines.next_line().await` is wrapped in `tokio::time::timeout(remaining, ...)`. On expiry it takes
  the existing `settled_by_grace = true; break;` convergence path, sharing downstream handling with
  the established grace-kill rather than adding a new failure mode, and additionally sets
  `settled_by_pending_task_max_wait`. Clearing the set clears the deadline, so a later pending task
  in the same turn re-arms it.

  An absolute deadline was implemented first and rejected on review: it would kill a healthy
  long-running subagent indiscriminately, which is precisely the class of harm this change exists to
  prevent.
- **A force-kill must not be silent**: when `settled_by_pending_task_max_wait` is set and
  `response_text` is still empty, `response_text` is replaced before `TurnCompleted` with an explicit
  "the background subagent did not report back in time and was abandoned" notice, so the turn does
  not look identical to a normal empty result. Real content is never overwritten; the notice is only
  written when there is genuinely nothing.
- **The post-result `WaitBgTasks` path is untouched**, keeping #983's unbounded
  `lines.next_line().await`. `active_background_task_ids` continues to serve only the Bash
  `backgroundTaskId` source and is never fed by `task_started`.
- **No pending task means no change**: when `pending_agent_task_ids` is empty, the
  `result_seen_at.is_none()` branch keeps its current bare wait, so a legitimate long turn with no
  background task involved is unaffected.

The separate set is the key structural point. Coupling "does this turn have a pending background
task" to "should the post-result wait block indefinitely" would let a signal that should only affect
the pre-result stage silently change post-result behavior. The two branches have genuinely different
risk models: pre-result, the CLI itself is waiting and what is missing is our own timeout for when
it wedges; post-result, the CLI considers the turn finished and the question is whether to keep
holding the process open for a background task. Two independent pieces of state keep each change
confined to its own branch.

## Known limitations

- Two overlapping pending tasks share a single deadline, so the later-arriving task can be abandoned
  earlier than its own full window would allow. The impact is small and this change does not address
  it.
- The trigger requires the CLI process to stay alive while its internal task tracking wedges
  permanently. That is a narrower condition than "the subagent crashed", and it has not been
  observed in practice. This change is defensive hardening against an unbounded wait, not a fix for
  an observed failure.
- `interrupt()` and the Stop button already recover a hung turn manually today. What is missing is
  automatic recovery, not any recovery at all.
- Background work lost *between* turns is a structurally different problem and is untouched here.

## Alternatives

- **A. Register into `active_background_task_ids` and bound the post-result `WaitBgTasks`.**
  Rejected: the reproductions above show the post-result branch is never entered while an Agent/Task
  is pending, making this dead code on the happy path, and bounding `WaitBgTasks` regresses #983,
  which chose unbounded deliberately.
- **B. Reuse the same `active_background_task_ids` set for the pre-result branch.** Saves one
  variable. Rejected: couples two independent wait semantics to one signal source, so a future
  change to either path can silently affect the other.
- **C. Bound every pre-result wait unconditionally.** Rejected: kills legitimate slow turns with no
  background task involved, which is not the risk being addressed.
  `CLAUDE_STREAM_FIRST_EVENT_TIMEOUT` (90s, covering "no events at all") is already this branch's
  existing, well-scoped protection and should not be replaced by a general bound.
- **D (adopted). Independent pending tracking, bounding only the pre-result branch.** See Decision.
  Targets the reachable gap precisely with no coupling or regression, reusing both existing helpers.

## Validation

- fake-stream: `task_started` followed by neither a terminal notification nor a `result` triggers the
  new pre-result max-wait, sets `settled_by_grace=true`, and converges instead of hanging.
- fake-stream: `task_started` plus a matching terminal notification before `result` (the real
  observed order) clears `pending_agent_task_ids` in time, does not trigger the bound, and completes
  through the existing post-result branch, where `active_background_task_ids` is empty because the
  Bash path is unaffected.
- fake-stream: a normal long turn with no `task_started` is unaffected, with
  `pending_agent_task_ids` empty throughout and the bare wait behaving as it does today.
- fake-stream: a pending task emitting an activity event every 1.5s for 4.5s, past the raw test
  bound, is not killed and ends normally with `result`, proving the bound is idle-based.
- fake-stream: the existing #983 Bash `backgroundTaskId` regressions stay green with post-result
  `WaitBgTasks` still unbounded.
- `openspec validate fix-claude-agent-pending-task-unbounded-wait --strict --no-interactive` passes.

## Open questions

- The `CLAUDE_BG_TASK_MAX_WAIT` value is reused unchanged from the existing production and test
  values. Only its application point is new (the pre-result branch), so the original reasoning still
  holds and is not re-derived here.
