## Why

With no saved language choice the app defaults **unconditionally to Chinese**, so
a first-run user on any non-Chinese OS gets a Chinese UI until they find the
language setting. Following the OS/webview locale on first run is the expected
default. The client language catalog (`client-localization-language-support`)
ships 10 languages (`zh` / `zh-TW` / `en` / `hi` / `es` / `fr` / `ja` / `ru` /
`ko` / `pt-BR`), so detection matches the OS locale's base subtag against all
of them, not just a zh/en split.

This is **not** the #1085 bug fix (a saved language choice being lost to a
startup race in `i18n`'s bootstrap read - see that fix's own PR). This change
is a genuine first-run **behavior change**: the default for anyone with
nothing saved moves from unconditional `zh` to the OS locale. Depends on that
fix's `loadClientStore` export, so it is stacked on top of it, but is its own
PR: the bugfix and this behavior-change decision should be independently
reviewable and independently revertible.

**Open question for review:** an OS locale outside the 10 shipped languages
currently falls back to `en`. Given the project defaults to `zh` today, would
you rather that fallback stay `zh`? Either is a one-line change
(`OS_LANGUAGE_SUBTAGS[...] ?? "en"` vs `?? "zh"`) - flagging it explicitly
rather than picking silently.

## 目标与边界

- Default the initial UI language to the OS locale when nothing is saved,
  across every language the app ships.
- Keep a saved explicit choice authoritative over the OS inference.

## 非目标

- Do not touch the startup-race fix itself (separate PR).
- Do not change how a language change is saved or applied at runtime.
- Do not touch the native menu localization (separate change).

## What Changes

- `src/i18n/index.ts`: add `detectOsLanguage()` (from `navigator.language`,
  matched by base subtag against every supported language; Chinese
  distinguishes Simplified vs Traditional by script/region: an explicit
  `Hans` subtag wins over region, e.g. `zh-Hans-HK` resolves to Simplified
  despite the Traditional-leaning region). `getStoredLanguage()` falls back
  to it instead of the hardcoded default when nothing valid is saved.
- `src/i18n/index.test.ts`: cover OS-locale default across the full supported
  set (zh/zh-TW script split, an unshipped locale falling back to en) and
  saved-choice-wins.
- `src/features/threads/loaders/claudeHistoryLoader.test.ts`: assertions that
  hardcoded Chinese literals for translated titles now read the expected
  value via `i18n.t(...)`, and a fixture that supplied a backend title equal
  to its own English translation now uses an unambiguous placeholder, since
  the default UI language is no longer always `zh`.

## Spec deltas

- `client-localization-language-support`: **ADDED** — a new requirement that
  the initial UI language follows the OS locale (matched against every
  shipped language) when nothing is saved; saved choice still wins.
