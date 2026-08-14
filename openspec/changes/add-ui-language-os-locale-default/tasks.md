## 1. OpenSpec Artifacts

- [x] 1.1 Author proposal + spec delta + tasks for OS-locale default; output: `openspec/changes/add-ui-language-os-locale-default`; validation: `openspec validate add-ui-language-os-locale-default --strict --no-interactive`. [P0][I][O: change dir][V: openspec validate]

## 2. Implementation

- [x] 2.1 `src/i18n/index.ts`: `detectOsLanguage()` matched against the full supported-language set + OS-locale fallback in `getStoredLanguage()`. Depends on the `loadClientStore` export added by the companion race-fix PR. [P0][I][O: index.ts][V: vitest]
- [x] 2.2 `src/i18n/index.test.ts`: OS-locale scenarios (zh/zh-TW script split, an unshipped locale falling back to en, saved-choice-wins). [P0][I][O: index.test.ts][V: vitest]
- [x] 2.3 `claudeHistoryLoader.test.ts`: assert control-event titles via `i18n.t(...)` instead of a hardcoded `zh` literal. [P0][I][O: claudeHistoryLoader.test.ts][V: vitest]

## 3. Gates

- [x] 3.1 `npm run typecheck`.
- [x] 3.2 `npx vitest run src/i18n/index.test.ts src/services/clientStorage.test.ts src/features/threads/loaders/claudeHistoryLoader.test.ts`.
- [x] 3.3 `npm run check:runtime-contracts`.
- [x] 3.4 Verified every test file importing the real `i18n` singleton (not the mocked `react-i18next`) still passes: `ErrorBoundary`, `toolConstants`, `useAppSettings`, `useTerminalTabs`, `useThreadApprovals`, `useThreadCompletionEmail`, `useThreadUserInput`, `useWorkspaces`, `claudeHistoryLoader` - 0 failures caused by the default-language change (1 pre-existing, unrelated flake in `useThreadApprovals`, confirmed present on a clean upstream checkout too).

## 4. Upstream

- [ ] 4.1 Open as its own PR after the race-fix PR lands (or rebase onto its merge commit). PR body states explicitly that this changes first-run default behavior (was unconditional `zh`), and raises the unshipped-locale-fallback choice (en vs zh) as an open question.
