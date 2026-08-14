// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampWindowOpacity,
  WINDOW_OPACITY_DEFAULT,
  useTransparencyPreference,
} from "./useTransparencyPreference";

const clientStorageMock = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));
const tauriServiceMock = vi.hoisted(() => ({
  setMainWindowOpacity: vi.fn(),
}));
const diagnosticsMock = vi.hoisted(() => ({
  appendRendererDiagnostic: vi.fn(),
}));

clientStorageMock.getClientStoreSync.mockImplementation((store: string, key: string) =>
  clientStorageMock.values.get(`${store}:${key}`),
);
clientStorageMock.writeClientStoreValue.mockImplementation(
  (store: string, key: string, value: unknown) => {
    clientStorageMock.values.set(`${store}:${key}`, value);
  },
);

vi.mock("../../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync: clientStorageMock.getClientStoreSync,
  writeClientStoreValue: clientStorageMock.writeClientStoreValue,
}));

vi.mock("../../../services/tauri", () => ({
  setMainWindowOpacity: tauriServiceMock.setMainWindowOpacity,
}));

vi.mock("../../../services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: diagnosticsMock.appendRendererDiagnostic,
}));

describe("useTransparencyPreference", () => {
  beforeEach(() => {
    clientStorageMock.values.clear();
    clientStorageMock.getClientStoreSync.mockClear();
    clientStorageMock.writeClientStoreValue.mockClear();
    tauriServiceMock.setMainWindowOpacity.mockReset();
    tauriServiceMock.setMainWindowOpacity.mockResolvedValue({
      requestedOpacity: 1,
      appliedOpacity: 1,
      applied: true,
      platform: "macos",
      reason: null,
    });
    diagnosticsMock.appendRendererDiagnostic.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps window transparency disabled by default for upgrade stability", () => {
    const { result } = renderHook(() => useTransparencyPreference());

    expect(result.current.reduceTransparency).toBe(true);
    expect(result.current.windowTransparencyEnabled).toBe(false);
    expect(result.current.windowOpacity).toBe(WINDOW_OPACITY_DEFAULT);
    expect(tauriServiceMock.setMainWindowOpacity).not.toHaveBeenCalled();
  });

  it("maps positive window transparency semantics to the legacy reduced-transparency key", () => {
    const { result } = renderHook(() => useTransparencyPreference());

    act(() => {
      result.current.setWindowTransparencyEnabled(true);
    });

    expect(result.current.reduceTransparency).toBe(false);
    expect(result.current.windowTransparencyEnabled).toBe(true);
    expect(clientStorageMock.values.get("layout:reduceTransparency")).toBe(false);
  });

  it("applies native window opacity instead of renderer CSS opacity", async () => {
    const { result } = renderHook(() => useTransparencyPreference());

    act(() => {
      result.current.setWindowTransparencyEnabled(true);
      result.current.setWindowOpacity(72);
    });

    await waitFor(() => {
      expect(tauriServiceMock.setMainWindowOpacity).toHaveBeenLastCalledWith(0.72);
    });
  });

  it("records a diagnostic when the native platform safely declines opacity", async () => {
    tauriServiceMock.setMainWindowOpacity.mockResolvedValue({
      requestedOpacity: 0.88,
      appliedOpacity: 0.88,
      applied: false,
      platform: "linux",
      reason: "native window opacity is not supported on this Linux runtime",
    });
    clientStorageMock.values.set("layout:reduceTransparency", false);

    renderHook(() => useTransparencyPreference());

    await waitFor(() => {
      expect(diagnosticsMock.appendRendererDiagnostic).toHaveBeenCalledWith(
        "window-opacity/unsupported",
        expect.objectContaining({
          platform: "linux",
        }),
      );
    });
  });

  it("sanitizes and persists window opacity", () => {
    clientStorageMock.values.set("layout:windowOpacity", 44);

    const { result } = renderHook(() => useTransparencyPreference());

    expect(result.current.windowOpacity).toBe(55);

    act(() => {
      result.current.setWindowOpacity(130);
    });

    expect(result.current.windowOpacity).toBe(100);
    expect(clientStorageMock.values.get("layout:windowOpacity")).toBe(100);
  });

  it("falls back for invalid opacity values", () => {
    expect(clampWindowOpacity(Number.NaN)).toBe(WINDOW_OPACITY_DEFAULT);
    expect(clampWindowOpacity("88")).toBe(WINDOW_OPACITY_DEFAULT);
  });
});
