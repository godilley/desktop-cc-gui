import { beforeEach, describe, expect, it, vi } from "vitest";

let storedLanguage = "zh";
let cachePopulated = false;
const writeClientStoreValueMock = vi.hoisted(() => vi.fn());
const loadClientStoreMock = vi.hoisted(() => vi.fn());

vi.mock("../services/clientStorage", () => ({
  // Only readable once loadClientStore "resolves" — mirrors the real bootstrap
  // race: the sync cache is empty until the store finishes loading.
  getClientStoreSync: vi.fn(() => (cachePopulated ? storedLanguage : undefined)),
  loadClientStore: loadClientStoreMock,
  writeClientStoreValue: writeClientStoreValueMock,
}));

describe("i18n dynamic locale loading", () => {
  beforeEach(() => {
    vi.resetModules();
    storedLanguage = "zh";
    cachePopulated = false;
    writeClientStoreValueMock.mockReset();
    loadClientStoreMock.mockReset().mockImplementation(async () => {
      cachePopulated = true;
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
    // here and fall back to the hardcoded default instead of the saved "en".
    storedLanguage = "en";

    const module = await import("./index");
    const i18n = await module.i18nReady;

    expect(loadClientStoreMock).toHaveBeenCalledWith("app");
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
