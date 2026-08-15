## 1. OpenSpec

- [x] 1.1 [P0] Author proposal / design / tasks / spec around an independent pre-result pending-task
      tracker rather than reusing `active_background_task_ids`
- [x] 1.2 [P0] `openspec validate fix-claude-agent-pending-task-unbounded-wait --strict --no-interactive`

## 2. Backend

- [x] 2.1 [P0] `claude.rs`: confirm the post-result `WaitBgTasks` branch keeps #983's unbounded
      `lines.next_line().await`. Verified by grep that `CLAUDE_BG_TASK_MAX_WAIT` did not previously
      appear in this file, so no revert was required
- [x] 2.2 [P0] `claude.rs`: add `pending_agent_task_ids: HashSet<String>` and
      `pending_agent_task_deadline: Option<Instant>`, and wire the bounded wait into the
      `result_seen_at.is_none()` branch, reusing `CLAUDE_BG_TASK_MAX_WAIT`. Both wait branches
      (empty buffer and non-empty `pending_text_delta`) are covered
- [x] 2.3 [P0] `claude_stream_helpers.rs` / `claude.rs`: add `extract_task_started_id` (symmetric
      with the existing `extract_terminal_task_release_id`), reusing
      `try_register_background_task_id` / `try_release_background_task_id`, wired to
      `pending_agent_task_ids` only, never to `active_background_task_ids`
- [ ] 2.4 [P1] Optional follow-up: treat `background_tasks_changed` (the all-clear event with
      `tasks:[]` seen in stream captures) as an additional signal for clearing
      `pending_agent_task_ids`. Not implemented
- [x] 2.5 [P0] Make the deadline an IDLE bound rather than an absolute one: it resets on every
      stream event received while a task is pending. An absolute deadline would kill a healthy
      long-running subagent and then report success silently. When force-kill fires and
      `response_text` is empty, write a visible `settled_by_pending_task_max_wait` notice instead
- [x] 2.6 [P0] `cargo check` and `cargo test --lib` verified on a Linux CI runner rather than
      locally. `cargo check` passes clean. The first real `cargo test --lib` run surfaced three
      incorrect assertions in the new tests themselves (not defects in `claude.rs`); after fixing
      those, results match the pre-existing baseline failure set with no new failures

## 3. Tests

- [x] 3.1 [P0] fake-stream `send_message_force_settles_pending_agent_task_that_never_notifies`:
      `task_started` with no terminal notification and no `result` converges once the pre-result
      idle max-wait (3s under test) expires, rather than hanging; asserts the response text carries
      the visible give-up notice rather than being empty
- [x] 3.2 [P0] fake-stream `send_message_pending_agent_task_settles_normally_before_result`:
      `task_started` plus a terminal notification before `result` (the real observed order) does not
      trigger the new max-wait (elapsed < 2s) and completes through the existing path
- [x] 3.3 [P0] fake-stream `send_message_unaffected_turn_survives_past_pending_task_max_wait`: a
      normal long turn with no `task_started` (elapsed >= 4s, past the 3s test bound) is unaffected
- [x] 3.4 [P0] Existing #983 Bash-path regressions (including
      `send_message_waits_past_grace_when_structured_background_task_active`) stay green unmodified.
      Since 2.1 is a no-op, there is no separate "restored to unbounded" assertion to add; those
      tests already sleep 7s, past the 3s test bound, which demonstrates independence from
      `CLAUDE_BG_TASK_MAX_WAIT`
- [x] 3.5 [P0] fake-stream `send_message_pending_agent_task_idle_reset_survives_past_raw_max_wait`:
      emits an activity event every 1.5s for 4.5s, past the raw 3s test bound, and asserts the turn
      is not killed and ends normally with `result`, proving the bound is idle-based
- [ ] 3.6 [P1] In-app reproduction: kill a background subagent process mid-flight and confirm the
      turn hangs before the change and converges after it. Not done; recorded as a known limitation
      rather than a blocker

## 4. Wrap-up

- [ ] 4.1 [P0] `openspec-verify-change`
- [ ] 4.2 [P1] Open the upstream PR
- [ ] 4.3 [P1] Separate follow-up, not addressed here: background work lost *between* turns is a
      structurally different problem from the within-turn settlement this change bounds. It remains
      unreproduced and uninvestigated; merging this change does not close it

## Non-tasks (explicitly out of scope)

- A native PreToolUse deny path
- Dedicated "waiting for agent" UI copy (P1, carried over from #983)
- Re-deriving the `CLAUDE_BG_TASK_MAX_WAIT` value; the existing value is reused, only its
  application point is new
- Editing #983's own proposal / design / spec files; this change depends on its mechanism but does
  not modify it
