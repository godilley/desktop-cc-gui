# App-integration friction log

**Purpose.** We (George + Claude) are adopting the app's **layered hybrid** workflow
(OpenSpec + Spec Hub + Trellis + our adversarial agent-tier) as the primary way we work,
across *all* repos. Because everything we'd evaluated it on so far was **already done**, we
risk confirmation bias. This log captures every rough edge we hit **while actually using**
Spec Hub / Trellis / OpenSpec on real work — so gaps become upstream issues/PRs instead of
being rationalised away.

**How to use.** Append an entry the moment friction is felt (don't batch). Keep each one
concrete: what we were doing, what got in the way, the evidence, and the smallest fix. Mark
`status` as `open` / `filed` / `fixed` / `wontfix`. Promote high-value ones to upstream
issues per the fork-contributor path (investigation doc §2–3).

| # | Area | Observation | Impact | Proposed fix | Status |
|---|------|-------------|--------|--------------|--------|
| 1 | OpenSpec CLI | The required CLI isn't discoverable: app shows `openspec not found` but no install command; the obvious npm `openspec` is a bogus `0.0.0` squat — real one is `@fission-ai/openspec`. We had to reverse-engineer it. | Blocks every gate until you already know the answer | Doctor error should print the exact install command (`npm i -g @fission-ai/openspec`); link in the "managed mode" hint | open |
| 2 | OpenSpec CLI | No version gate — app runs whatever `openspec` is on PATH; docs pin 1.3.1 but nothing enforces it. Subcommand syntax could silently drift on a newer CLI. | Silent breakage risk on version mismatch | Warn in Doctor when `openspec --version` ≠ documented baseline | open |
| 3 | Spec Hub | **Apply-execute runs a full-access agent in the LIVE workspace, not a worktree** (`useSpecHub.ts` dispatch bound to current `workspaceId`; zero worktree code in spec-core). No isolation for autonomous code-writing. | A background agent edits your working tree directly; hard to review/revert as a unit | Option to run Apply in a git worktree (like Trellis) and surface a diff to approve | open |
| 4 | Spec Hub | **Single-flight** — one global busy-lock (`isRunningAction`, not per-change, no queue). Can't Apply change A while B applies, or author C while any action runs. | Kills the "work on multiple changes at once" mental model | Per-change action-state map + a queue, so multiple changes can progress | open |
| 5 | Spec Hub | Apply **guidance mode** (`applyMode:"guidance"`, no code) is fully implemented in the hook but **not surfaced as a UI toggle** — only `"execute"` is ever passed. | Users can't get a dry-run/plan before letting the agent write code | Expose a guidance/execute switch on the Apply button | open |
| 6 | Spec Hub | Only Apply-execute tags its dispatch as background `system-auto`; New/Append Proposal, AI Takeover, Continue-AI-analysis, Auto-complete, and Combo create **ordinary visible sessions** in the workspace. | Session-list clutter; unclear which sessions are system-driven | Tag all spec-hub dispatches with `autoSession` (or a consistent visibility) | open |
| 7 | Trellis | Trellis isn't drivable **from the app** — only a read-only journal/evidence panel. Its real value (detached processes + worktrees that **survive the GUI restarting the CLI**) is invisible in the UI. | The one thing that fixes our "background agents die in this GUI" pain is CLI-only | Surface Trellis run/launch + status in-app | open |
| 8 | Trellis | Ralph Loop verification **rubber-stamps after 5 iterations** (fail-open) and its `[finish]`-phase detection is self-documented broken (`ralph-loop.py:268-273`). | Automated "verification" can pass a broken change | Make max-iterations fail-closed; fix `[finish]` detection (candidate first Trellis-governed change) | open |

_Seed entries (1–8) are from this session's two Spec Hub / Trellis code investigations — evidence-backed, pre-first-real-run. Everything below should come from lived use._

---

## Lived-use entries

_(none yet — add as we run the hybrid on real changes, starting with the perf-pack prove-run)_
