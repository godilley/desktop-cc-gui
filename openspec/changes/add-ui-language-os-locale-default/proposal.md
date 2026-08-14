## Why

With no saved language choice the app defaults **unconditionally to Chinese**, so
a first-run user on any non-Chinese OS gets a Chinese UI until they find the
language setting. Following the OS/webview locale on first run is the expected
default. Upstream ships 10 languages (`zh` / `zh-TW` / `en` / `hi` / `es` /
`fr` / `ja` / `ru` / `ko` / `pt-BR`), so detection matches the OS locale's base
subtag against all of them, not just a zh/en split.

This is **not** the #1085 race-fix bug (that's `fix/i18n-stored-language-race`,
a separate small PR: a saved choice was being lost to a startup race). This
change is a genuine first-run **behavior change** — upstream currently defaults
unconditionally to `zh` for anyone with nothing saved, and this proposal makes
that default follow the OS locale instead. Depends on the race-fix branch
(needs `loadClientStore` to exist) but is its own PR, opened separately, and
the PR description says explicitly that it changes default behavior so the
maintainer reviews it as a product decision, not a drive-by bugfix.

## 目标与边界

- Default the initial UI language to the OS locale when nothing is saved,
  across every language the app ships.
- Keep a saved explicit choice authoritative over the OS inference.

## 非目标

- Do not touch the startup-race fix itself (separate PR, already landed or in
  review by the time this one opens).
- Do not change how a language change is saved or applied at runtime.
- Do not touch the native menu localization (separate change).

## What Changes

- `src/i18n/index.ts`: add `detectOsLanguage()` (from `navigator.language`,
  matched by base subtag against every supported language; Chinese
  distinguishes Simplified vs Traditional by script/region). `getStoredLanguage()`
  falls back to it instead of the hardcoded default when nothing valid is saved.
- `src/i18n/index.test.ts`: cover OS-locale default across the full supported
  set (zh/zh-TW script split, ko, pt-BR, an unshipped locale falling back to
  en) and saved-choice-wins.
- `src/features/threads/loaders/claudeHistoryLoader.test.ts`: assert the
  translated control-event titles via `i18n.t(...)` instead of a hardcoded
  Chinese literal, since the default UI language is no longer always `zh`.

## Spec deltas

- `ui-language-default-selection` (new capability): **ADDED** — default follows
  OS locale (matched against every shipped language) when nothing is saved;
  saved choice wins.

## Upstream disposition

🟡 **Ship as its own PR, opened after the race-fix PR, explicit about being a
behavior change.** The PR description states plainly that this changes
first-run default behavior (was unconditional `zh`) and invites the maintainer
to weigh in or reject the default-language decision — it is not folded into
the race-fix bug report.

(The `services/clientStorage` test-mock fan-out and the optional shared-helper
offer belong to the `fix/i18n-stored-language-race` PR, where that fan-out
actually happened — not repeated here.)
