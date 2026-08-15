## ADDED Requirements

### Requirement: Pending Agent/Task Subagents Are Tracked Independently Of Post-Result Blockers

When the current turn's stream emits a `type: "system", subtype: "task_started"` event before that turn's own `result` event has been seen, ccgui MUST register that event's `task_id` in a dedicated pending-task tracking set that is independent of the `active_background_task_ids` set used by `claude-background-task-settlement` (issue #983) for its post-result `WaitBgTasks` behavior.

This separation exists because the two waits have different risk models: the post-result wait
(#983) exists because the CLI's own `result` event can arrive while a Bash background shell is
still running, and #983 deliberately leaves that wait unbounded. The pre-result wait this
requirement covers exists because, for Agent/Task subagents, the CLI observably defers its own
`result` event until every pending background task has settled, so `result_seen_at` never becomes
`Some` while such a task is pending, and the existing post-result mechanisms never engage for this
case at all.

#### Scenario: a background Agent/Task call registers a pending-task entry before `result`

- **WHEN** the current turn's stream emits `{"type":"system","subtype":"task_started","task_id":"<id>",...}`
- **AND** the turn's `result` event has not yet been seen
- **THEN** ccgui MUST add `<id>` to a dedicated pending-task tracking set, separate from
  `active_background_task_ids`
- **AND** MUST NOT add it to `active_background_task_ids`

#### Scenario: a matching terminal task-notification clears the pending-task entry

- **GIVEN** `<id>` is present in the pending-task tracking set
- **WHEN** the stream emits a matching terminal `task_notification` for `task_id = "<id>"`
  (`status` completed/failed/stopped)
- **THEN** ccgui MUST remove `<id>` from the pending-task tracking set, using the same terminal-
  status matching logic `claude-background-task-settlement` already defines for its own release
  path
- **AND** any subsequent stream content produced as part of that notification's continuation
  (`origin.kind == "task-notification"`) MUST be appended into the same turn's response, using the
  existing post-result text-delta accumulation path once `result` is eventually seen

### Requirement: The Pre-Result Wait Has An Idle Maximum When A Task Is Pending

While the pending-task tracking set is non-empty and the turn's `result` event has not yet been seen, the stream-read wait MUST be bounded by `CLAUDE_BG_TASK_MAX_WAIT` as an IDLE bound, not an absolute one: the deadline MUST reset to `now + CLAUDE_BG_TASK_MAX_WAIT` on every successfully parsed stream line received while the pending-task tracking set remains non-empty, so a subagent that is genuinely still producing activity never trips it regardless of total elapsed duration. Only a stream that goes fully silent for the entire `CLAUDE_BG_TASK_MAX_WAIT` window trips the bound. When the pending-task tracking set is empty, this wait MUST remain unbounded (matching today's behavior for a normal turn with no background task involved).

An absolute (arm-once, never-reset) bound was rejected during review: it would force-kill a legitimately long-running, still-active background subagent and report the turn as success with no visible indication anything was destroyed, trading a visible, user-recoverable hang (today's Stop button already works) for a silent, unrecoverable one. See the force-killed-turn-must-be-visible requirement below.

#### Scenario: a pending task that goes fully idle is force-killed after the idle max-wait

- **GIVEN** the pending-task tracking set is non-empty (a `task_started` was seen, no matching
  terminal notification yet)
- **AND** the turn's `result` event has not been seen
- **WHEN** `CLAUDE_BG_TASK_MAX_WAIT` elapses with no stream line received in that window, the set
  not clearing, and stdout not reaching EOF
- **THEN** ccgui MUST force-kill the process tree via the existing grace-kill path
- **AND** MUST treat this the same as an existing grace-kill for exit-status/settlement purposes
  (not a new failure mode)

#### Scenario: a pending task that keeps producing activity is never force-killed regardless of total duration

- **GIVEN** the pending-task tracking set is non-empty
- **WHEN** at least one stream line is received at intervals shorter than `CLAUDE_BG_TASK_MAX_WAIT`,
  for a total duration exceeding `CLAUDE_BG_TASK_MAX_WAIT`
- **THEN** ccgui MUST NOT force-kill the process tree, no matter how long this continues
- **AND** the turn continues waiting for `result` exactly as it does today when no background task
  was ever involved

#### Scenario: a pending task that settles before the idle max-wait bound is unaffected

- **WHEN** the pending-task tracking set clears (or stdout reaches EOF) before
  `CLAUDE_BG_TASK_MAX_WAIT` elapses since the last received line
- **THEN** no force-kill occurs from this requirement
- **AND** the turn continues waiting for `result` exactly as it does today when no background task
  was ever involved

### Requirement: A Force-Killed Pending Task Must Never Look Like A Silent Empty Success

When the idle max-wait force-kills the process tree while `response_text` would otherwise be empty, ccgui MUST synthesize a visible notice into the turn's response text rather than completing the turn with silent empty content. An abandoned background subagent MUST be distinguishable from an ordinary turn that legitimately produced no text. This MUST NOT overwrite any real partial response content the stream already produced before the subagent went silent.

#### Scenario: an idle-abandoned pending task with no other content gets a visible notice

- **GIVEN** the idle max-wait force-kills the process tree per the requirement above
- **AND** `response_text` is empty at that point
- **THEN** ccgui MUST replace `response_text` with a notice indicating a background subagent did
  not report back and was abandoned
- **AND** the turn MUST still complete (`TurnCompleted`), not error, so the notice is visible to
  the user

#### Scenario: real partial content is preserved, not overwritten by the notice

- **GIVEN** the idle max-wait force-kills the process tree per the requirement above
- **AND** `response_text` already contains real content produced earlier in the same turn
- **THEN** ccgui MUST NOT overwrite that content with the abandonment notice

#### Scenario: a turn with no pending Agent/Task subagent is never bounded by this requirement

- **GIVEN** the pending-task tracking set has been empty for the entire turn
- **WHEN** the turn's `result` event has still not been seen after an arbitrarily long duration
- **THEN** ccgui MUST NOT force-kill the process tree under this requirement
- **AND** the existing unbounded wait behavior for a long-running turn is preserved unchanged

### Requirement: The Post-Result Bash Background-Shell Wait Remains Unbounded

`claude-background-task-settlement`'s (#983) post-result `WaitBgTasks` behavior, gated by `active_background_task_ids`, MUST remain unbounded. This requirement is stated explicitly because bounding the pre-result wait invites the symmetric change on the post-result path, and that symmetry does not hold: no evidence supports bounding the Bash background-shell path, where the CLI emits `result` while the shell is still running, and #983 deliberately chose to leave it unbounded.

#### Scenario: a long-running Bash background shell after `result` is not force-killed by a max-wait bound

- **GIVEN** `active_background_task_ids` is non-empty after the turn's `result` event (a Bash
  background shell registered via `backgroundTaskId`)
- **WHEN** an arbitrarily long duration elapses without the blocker releasing
- **THEN** ccgui MUST NOT force-kill the process tree due to any maximum-wait bound
- **AND** MUST continue waiting until the blocker releases, EOF is reached, or the user stops the
  turn (the pre-existing #983 behavior, unmodified)
