## ADDED Requirements

### Requirement: The UI Language Default MUST Follow The OS Locale When No Choice Is Saved

系统 MUST 在用户没有保存显式语言选择时，依据操作系统 / webview 的语言（`navigator.language`）的基础子标签，
在已支持的语言集合（`zh` / `zh-TW` / `en` / `hi` / `es` / `fr` / `ja` / `ru` / `ko` / `pt-BR`）中匹配初始界面语言，
而不是无条件默认中文；无法识别的 OS 语言 MUST 回退到 `en`。已保存的显式选择 MUST 始终优先于该 OS 推断。

> POLICY NOTE (behavior change, disclosed not silent): upstream currently defaults
> unconditionally to `zh`. This requirement changes that default for every non-Chinese
> OS locale. Ship as a normal PR, but the PR description MUST state plainly that this
> changes first-run default behavior, so the maintainer reviews it as a product
> decision rather than discovering it inside an otherwise-bugfix diff.

#### Scenario: no saved choice on a Chinese OS resolves to zh or zh-TW by script

- **WHEN** 没有已保存的语言选择
- **AND** `navigator.language` 以 `zh` 开头
- **THEN** 若该值指示繁体（如包含 `Hant`、`-TW`、`-HK`）初始界面语言 MUST 为 `zh-TW`
- **AND** 否则（如 `zh-Hans-CN`）初始界面语言 MUST 为 `zh`

#### Scenario: no saved choice on an OS locale we ship resolves to that language

- **WHEN** 没有已保存的语言选择
- **AND** `navigator.language` 的基础子标签匹配已支持语言之一（如 `ko-KR` → `ko`，`pt-PT` → `pt-BR`）
- **THEN** 初始界面语言 MUST 为该匹配语言

#### Scenario: no saved choice on an unshipped OS locale resolves to en

- **WHEN** 没有已保存的语言选择
- **AND** `navigator.language` 的基础子标签不匹配任何已支持语言（如 `th-TH`）
- **THEN** 初始界面语言 MUST 为 `en`

#### Scenario: a saved explicit choice always wins over the OS locale

- **WHEN** 用户已保存显式语言选择（任一已支持语言）
- **THEN** 系统 MUST 使用该保存值
- **AND** 系统 MUST NOT 用 OS 推断覆盖它
