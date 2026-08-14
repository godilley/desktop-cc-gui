## 1. OpenSpec Artifacts

- [x] 1.1 Author proposal + spec delta + tasks for OS-locale default; output: `openspec/changes/add-ui-language-os-locale-default`; validation: `openspec validate add-ui-language-os-locale-default --strict --no-interactive`. [P0][I][O: change dir][V: openspec validate]

## 2. Implementation

- [x] 2.1 `src/i18n/index.ts`: `detectOsLanguage()` matched against the full supported-language set + OS-locale fallback in `getStoredLanguage()`. Depends on `loadClientStore` from `fix/i18n-stored-language-race` (separate branch/PR) already being in the tree. [P0][I][O: index.ts][V: vitest]
- [x] 2.2 `src/i18n/index.test.ts`: OS-locale scenarios (zh/zh-TW script split, ko, pt-BR, unshipped→en, saved-choice-wins). [P0][I][O: index.test.ts][V: vitest]
- [x] 2.3 `claudeHistoryLoader.test.ts`: assert control-event titles via `i18n.t(...)` instead of a hardcoded `zh` literal. [P0][I][O: claudeHistoryLoader.test.ts][V: vitest]

## 3. Gates

- [x] 3.1 `npm run typecheck`.
- [x] 3.2 `npx vitest run src/i18n/index.test.ts src/services/clientStorage.test.ts src/features/threads/loaders/claudeHistoryLoader.test.ts`.

## 4. Upstream

- [ ] 4.1 Open this PR against `upstream/main` **after** the `fix/i18n-stored-language-race` PR lands (or rebase onto its merge commit). PR body MUST state explicitly that this changes first-run default behavior (was unconditional `zh`).
- [ ] 4.2 In the PR body, raise the shared-clientStorage-test-mock-helper idea as an optional question/offer (see proposal.md "Optional follow-up to offer, not to force") — not a requirement, not bundled into this diff.
