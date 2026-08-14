import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  getClientStoreSync,
  loadClientStore,
  writeClientStoreValue,
} from "../services/clientStorage";

export type SupportedLanguage =
  | "zh"
  | "zh-TW"
  | "en"
  | "hi"
  | "es"
  | "fr"
  | "ja"
  | "ru"
  | "ko"
  | "pt-BR";

/**
 * Single source of truth for the language picker. `nativeName` is the language's
 * own endonym, so it renders correctly regardless of the active UI language and
 * needs no translation key. Order mirrors the product's chosen display order.
 */
export const SUPPORTED_LANGUAGES: ReadonlyArray<{
  code: SupportedLanguage;
  nativeName: string;
}> = [
  { code: "zh", nativeName: "简体中文" },
  { code: "zh-TW", nativeName: "繁體中文" },
  { code: "en", nativeName: "English" },
  { code: "hi", nativeName: "हिन्दी" },
  { code: "es", nativeName: "Español" },
  { code: "fr", nativeName: "Français" },
  { code: "ja", nativeName: "日本語" },
  { code: "ru", nativeName: "Русский" },
  { code: "ko", nativeName: "한국어" },
  { code: "pt-BR", nativeName: "Português (Brasil)" },
];

const supportedLanguages = new Set<SupportedLanguage>(
  SUPPORTED_LANGUAGES.map((entry) => entry.code),
);

const DEFAULT_LANGUAGE: SupportedLanguage = "zh";

/**
 * Full locale loaders. P2-3 tried critical/deferred split for cold-start size, but
 * shell/settings surfaces regressed (raw keys like files.loadingFiles /
 * settings.sidebarBasic) whenever deferred packs lagged. Product correctness
 * wins: load the complete language pack before rendering i18n-backed UI.
 *
 * locales star critical.ts and deferred.ts remain as source organization helpers
 * composed by locales star index.ts; runtime always imports the full index.
 */
const localeLoaders: Partial<
  Record<SupportedLanguage, () => Promise<{ default: Record<string, unknown> }>>
> = {
  en: () => import("./locales/en"),
  "zh-TW": () => import("./locales/zh-TW"),
  hi: () => import("./locales/hi"),
  es: () => import("./locales/es"),
  fr: () => import("./locales/fr"),
  ja: () => import("./locales/ja"),
  ru: () => import("./locales/ru"),
  ko: () => import("./locales/ko"),
  "pt-BR": () => import("./locales/pt-BR"),
  zh: () => import("./locales/zh"),
};

/**
 * Per-language fallback chains. Traditional Chinese degrades to Simplified before
 * English; every other bundle-less language degrades straight to English. Kept in
 * sync with the `fallbackLng` object passed to i18next at init time.
 */
const fallbackChains: Partial<Record<SupportedLanguage, SupportedLanguage[]>> = {
  "zh-TW": ["zh", "en"],
};
const DEFAULT_FALLBACK: SupportedLanguage[] = ["en"];

function fallbackChainFor(lang: SupportedLanguage): SupportedLanguage[] {
  return fallbackChains[lang] ?? DEFAULT_FALLBACK;
}

const i18nextFallback = SUPPORTED_LANGUAGES.reduce<Record<string, string[]>>(
  (acc, { code }) => {
    if (fallbackChains[code]) {
      acc[code] = fallbackChains[code] as string[];
    }
    return acc;
  },
  { default: DEFAULT_FALLBACK },
);

const loadedLanguages = new Set<SupportedLanguage>();
const loadedResources: Partial<Record<SupportedLanguage, Record<string, unknown>>> = {};

function normalizeLanguage(lang: string | undefined): SupportedLanguage {
  return supportedLanguages.has(lang as SupportedLanguage)
    ? (lang as SupportedLanguage)
    : DEFAULT_LANGUAGE;
}

// No saved choice → follow the OS/webview locale, matched by base subtag
// against every language we ship; a validly saved choice always wins over
// this inference. Chinese needs a script check (Simplified vs Traditional)
// since both share the "zh" subtag; an unrecognized subtag falls back to en.
const OS_LANGUAGE_SUBTAGS: Partial<Record<string, SupportedLanguage>> = {
  en: "en",
  es: "es",
  fr: "fr",
  hi: "hi",
  ja: "ja",
  ru: "ru",
  ko: "ko",
  pt: "pt-BR",
};

const detectOsLanguage = (): SupportedLanguage => {
  const sys = (typeof navigator !== "undefined" ? navigator.language || "" : "").toLowerCase();
  if (sys.startsWith("zh")) {
    // An explicit script subtag (Hans/Hant) is authoritative over region,
    // since Hong Kong/Macau ship both scripts (e.g. zh-Hans-HK is Simplified
    // despite the "-hk" region, matching zh-Hant-CN being Traditional).
    if (sys.includes("hans")) {
      return "zh";
    }
    return sys.includes("hant") || sys.includes("-tw") || sys.includes("-hk") || sys.includes("-mo")
      ? "zh-TW"
      : "zh";
  }
  return OS_LANGUAGE_SUBTAGS[sys.split("-")[0]] ?? "en";
};

const getStoredLanguage = (): SupportedLanguage => {
  const stored = getClientStoreSync<string>("app", "language");
  if (stored !== undefined && supportedLanguages.has(stored as SupportedLanguage)) {
    return stored as SupportedLanguage;
  }
  return detectOsLanguage();
};

export const saveLanguage = (lang: string): void => {
  writeClientStoreValue("app", "language", normalizeLanguage(lang));
};

if (initReactI18next && typeof initReactI18next === "object") {
  i18n.use(initReactI18next);
}

const i18nInstance = i18n;

/** Load a single full bundle if it exists and hasn't been loaded yet (idempotent). */
async function loadBundle(lang: SupportedLanguage): Promise<void> {
  if (loadedLanguages.has(lang)) {
    return;
  }
  const loader = localeLoaders[lang];
  if (!loader) {
    return; // no bundle for this language yet — handled by fallback chain
  }
  const resource = await loader();
  loadedResources[lang] = resource.default;
  if (i18nInstance.isInitialized && typeof i18nInstance.addResourceBundle === "function") {
    i18nInstance.addResourceBundle(lang, "translation", resource.default, true, true);
  }
  loadedLanguages.add(lang);
}

async function loadLanguageResource(lang: string | undefined): Promise<SupportedLanguage> {
  const normalized = normalizeLanguage(lang);
  await loadBundle(normalized);
  // Languages without their own bundle need fallback resources loaded so that
  // i18next can resolve keys instead of showing raw key strings. Languages with
  // an explicit custom chain keep that chain warm as a recovery path.
  if (!localeLoaders[normalized] || fallbackChains[normalized]) {
    for (const fallback of fallbackChainFor(normalized)) {
      await loadBundle(fallback);
    }
  }
  return normalized;
}

const originalChangeLanguage = i18nInstance.changeLanguage.bind(i18nInstance);

i18nInstance.changeLanguage = (async (
  lang?: string,
  callback?: Parameters<typeof i18nInstance.changeLanguage>[1],
) => {
  const normalized = await loadLanguageResource(lang ?? getStoredLanguage());
  return originalChangeLanguage(normalized, callback);
}) as typeof i18nInstance.changeLanguage;

export const i18nReady = (async () => {
  // Ensure the "app" store is in cache before we read the saved language,
  // otherwise the sync read races the bootstrap preload and we'd fall back to
  // the hardcoded default even when the user has an explicit choice saved.
  // Fixes upstream #1085 (saved language reset on every restart).
  await loadClientStore("app");
  const initialLanguage = await loadLanguageResource(getStoredLanguage());
  const resources = Object.entries(loadedResources).reduce<
    Record<string, { translation: Record<string, unknown> }>
  >((acc, [lng, resource]) => {
    acc[lng] = { translation: resource ?? {} };
    return acc;
  }, {});
  await i18nInstance.init({
    resources,
    lng: initialLanguage,
    fallbackLng: i18nextFallback,
    interpolation: {
      escapeValue: false,
    },
  });
  return i18nInstance;
})();

export default i18n;
