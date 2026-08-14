// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import type { ReleaseNotesEntry } from "../utils/changelogParser";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../utils/releaseNotesCatalog", () => ({
  catalogToStubEntries: vi.fn((items: Array<{ version: string; tagName: string; id: string; title: string; dateLabel: string }>) =>
    items.map((item) => ({
      ...item,
      englishBody: "",
      chineseBody: "",
    })),
  ),
  loadReleaseNotesIndex: vi.fn(),
  loadReleaseNotesEntry: vi.fn(),
}));

import {
  findReleaseIndex,
  normalizeReleaseVersion,
  parseChangelogEntries,
  RELEASE_NOTES_AUTO_OPEN_DELAY_MS,
  useReleaseNotes,
} from "./useReleaseNotes";
import {
  loadReleaseNotesEntry,
  loadReleaseNotesIndex,
} from "../utils/releaseNotesCatalog";

const getVersionMock = vi.mocked(getVersion);
const getClientStoreSyncMock = vi.mocked(getClientStoreSync);
const writeClientStoreValueMock = vi.mocked(writeClientStoreValue);
const loadIndexMock = vi.mocked(loadReleaseNotesIndex);
const loadEntryMock = vi.mocked(loadReleaseNotesEntry);

const sampleEntry: ReleaseNotesEntry = {
  id: "0.8.8",
  tagName: "v0.8.8",
  version: "0.8.8",
  title: "v0.8.8",
  dateLabel: "2026/08/12",
  englishBody: "English body",
  chineseBody: "中文正文",
};

function mockCatalogReady() {
  loadIndexMock.mockResolvedValue({
    generatedAt: "2026-08-12T00:00:00.000Z",
    source: "CHANGELOG.md",
    sourceSha256: "test",
    entryCount: 1,
    entries: [
      {
        id: sampleEntry.id,
        tagName: sampleEntry.tagName,
        version: sampleEntry.version,
        title: sampleEntry.title,
        dateLabel: sampleEntry.dateLabel,
        file: "entries/0.8.8.json",
      },
    ],
  });
  loadEntryMock.mockResolvedValue(sampleEntry);
}

describe("useReleaseNotes public re-exports", () => {
  it("exposes normalizeReleaseVersion", () => {
    expect(normalizeReleaseVersion("v1.2.3")).toBe("1.2.3");
  });

  it("exposes parseChangelogEntries", () => {
    const entries = parseChangelogEntries(`
### **2026年1月1日（v1.0.0）**

English:
- hello

中文：
- 你好
`);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe("1.0.0");
  });

  it("exposes findReleaseIndex", () => {
    const entries: ReleaseNotesEntry[] = [
      {
        id: "1.0.0",
        tagName: "v1.0.0",
        version: "1.0.0",
        title: "v1.0.0",
        dateLabel: "2026/01/01",
        englishBody: "",
        chineseBody: "",
      },
    ];
    expect(findReleaseIndex(entries, "1.0.0")).toBe(0);
  });
});

describe("useReleaseNotes auto-open + lastSeen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCatalogReady();
    getVersionMock.mockResolvedValue("0.8.8");
    getClientStoreSyncMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays auto-open by RELEASE_NOTES_AUTO_OPEN_DELAY_MS on version bump", async () => {
    const { result } = renderHook(() => useReleaseNotes());

    // Flush getVersion().then(...) so the 2s timer is armed.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isOpen).toBe(false);
    expect(loadIndexMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELEASE_NOTES_AUTO_OPEN_DELAY_MS - 1);
    });
    expect(result.current.isOpen).toBe(false);
    expect(loadIndexMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    // openReleaseNotes is async: flush microtasks after the timer fires.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(loadIndexMock).toHaveBeenCalledTimes(1);
    expect(loadEntryMock).toHaveBeenCalledWith("0.8.8", false);
    expect(writeClientStoreValueMock).toHaveBeenCalledWith(
      "app",
      "releaseNotesLastSeenVersion",
      "0.8.8",
    );
  });

  it("does not auto-open when lastSeen already matches current version", async () => {
    getClientStoreSyncMock.mockReturnValue("0.8.8");

    const { result } = renderHook(() => useReleaseNotes());

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(RELEASE_NOTES_AUTO_OPEN_DELAY_MS + 50);
      await Promise.resolve();
    });

    expect(result.current.isOpen).toBe(false);
    expect(loadIndexMock).not.toHaveBeenCalled();
  });

  it("writes lastSeen when content is successfully shown (not only on close)", async () => {
    const { result } = renderHook(() => useReleaseNotes({ enabled: false }));

    await act(async () => {
      await result.current.openReleaseNotes({ preferredVersion: "0.8.8" });
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.activeEntry?.version).toBe("0.8.8");
    expect(writeClientStoreValueMock).toHaveBeenCalledWith(
      "app",
      "releaseNotesLastSeenVersion",
      "0.8.8",
    );
  });

  it("does not write lastSeen when open fails to load", async () => {
    loadIndexMock.mockRejectedValue(new Error("index missing"));
    const { result } = renderHook(() => useReleaseNotes({ enabled: false }));

    await act(async () => {
      await result.current.openReleaseNotes({ preferredVersion: "0.8.8" });
    });

    expect(result.current.error).toContain("index missing");
    expect(writeClientStoreValueMock).not.toHaveBeenCalled();
  });
});
