import { beforeEach, describe, expect, it, vi } from "vitest";

let storedLanguage: string | undefined = "zh";
let navigatorLanguage = "zh-CN";
let cachePopulated = false;
const writeClientStoreValueMock = vi.hoisted(() => vi.fn());
const loadClientStoreMock = vi.hoisted(() => vi.fn());

vi.mock("../services/clientStorage", () => ({
  // Only readable once loadClientStore "resolves", mirroring the real bootstrap
  // race: the sync cache is empty until the store finishes loading.
  getClientStoreSync: vi.fn(() => (cachePopulated ? storedLanguage : undefined)),
  loadClientStore: loadClientStoreMock,
  writeClientStoreValue: writeClientStoreValueMock,
}));

describe("i18n dynamic locale loading", () => {
  beforeEach(() => {
    vi.resetModules();
    storedLanguage = "zh";
    navigatorLanguage = "zh-CN";
    cachePopulated = false;
    writeClientStoreValueMock.mockReset();
    loadClientStoreMock.mockReset().mockImplementation(async () => {
      cachePopulated = true;
    });
    vi.stubGlobal("navigator", {
      get language() {
        return navigatorLanguage;
      },
    });
  });

  it("loads only the stored startup locale and loads another locale on switch", async () => {
    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("zh");
    expect(i18n.hasResourceBundle("zh", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(false);
    // Full pack must resolve shell + settings keys (P2-3 regression guard).
    expect(i18n.t("files.loadingFiles")).not.toBe("files.loadingFiles");
    expect(i18n.t("settings.sidebarBasic")).not.toBe("settings.sidebarBasic");

    await i18n.changeLanguage("en");

    expect(i18n.language).toBe("en");
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.t("files.loadingFiles")).not.toBe("files.loadingFiles");
    expect(i18n.t("settings.sidebarBasic")).not.toBe("settings.sidebarBasic");
  });

  it("awaits loadClientStore before reading the stored language (regression for #1085)", async () => {
    // Without the await, getClientStoreSync would still see an empty cache
    // here and fall back to the OS/hardcoded default instead of the saved "en".
    storedLanguage = "en";
    navigatorLanguage = "zh-CN";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(loadClientStoreMock).toHaveBeenCalledWith("app");
    expect(i18n.language).toBe("en");
  });

  it("defaults to the OS locale when nothing is stored", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "en-GB";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("en");
  });

  it("defaults to zh when the OS locale is Chinese and nothing is stored", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "zh-Hans-CN";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("zh");
  });

  it("defaults to zh-TW when the OS locale is Traditional Chinese and nothing is stored", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "zh-Hant-TW";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("zh-TW");
  });

  it("defaults to zh-TW for a Macau OS locale and nothing is stored", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "zh-MO";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("zh-TW");
  });

  it("defaults to zh when the OS locale is explicitly Simplified in a Traditional-leaning region", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "zh-Hans-HK";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("zh");
  });

  it("defaults to ko when the OS locale is Korean and nothing is stored", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "ko-KR";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("ko");
  });

  it("defaults to pt-BR when the OS locale is Portuguese and nothing is stored", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "pt-PT";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("pt-BR");
  });

  it("falls back to en for an OS locale we don't ship", async () => {
    storedLanguage = undefined;
    navigatorLanguage = "th-TH";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("en");
  });

  it("prefers the stored choice over the OS locale", async () => {
    storedLanguage = "en";
    navigatorLanguage = "zh-CN";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(i18n.language).toBe("en");
  });

  it("loads a newly shipped translation bundle on switch", async () => {
    const module = await import("./index");
    const i18n = await module.i18nReady;

    await i18n.changeLanguage("ja");

    expect(i18n.language).toBe("ja");
    expect(i18n.hasResourceBundle("ja", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(false);
  });

  it("loads the Simplified-then-English chain for Traditional Chinese", async () => {
    const module = await import("./index");
    const i18n = await module.i18nReady;

    await i18n.changeLanguage("zh-TW");

    expect(i18n.language).toBe("zh-TW");
    expect(i18n.hasResourceBundle("zh-TW", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("zh", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
  });

  it("preserves saveLanguage storage behavior", async () => {
    const { saveLanguage } = await import("./index");

    saveLanguage("en");

    expect(writeClientStoreValueMock).toHaveBeenCalledWith("app", "language", "en");
  });

  it("normalizes unsupported stored languages before persisting", async () => {
    const { saveLanguage } = await import("./index");

    saveLanguage("klingon");

    expect(writeClientStoreValueMock).toHaveBeenCalledWith("app", "language", "zh");
  });
});
