// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSelectedAgentSession } from "./useSelectedAgentSession";

type Store = Record<string, unknown>;

const {
  appStore,
  getClientStoreSync,
  listAgentConfigs,
  listBuiltInAgents,
  writeClientStoreValue,
} = vi.hoisted(() => {
  const appStore: Store = {};
  return {
    appStore,
    getClientStoreSync: vi.fn((store: string, key: string) => {
      if (store !== "app") {
        return undefined;
      }
      return appStore[key];
    }),
    writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
      if (store === "app") {
        appStore[key] = value;
      }
    }),
    listAgentConfigs: vi.fn(async () => []),
    listBuiltInAgents: vi.fn(),
  };
});

vi.mock("../../services/clientStorage", () => ({
  loadClientStore: vi.fn(() => Promise.resolve()),
  getClientStoreSync,
  writeClientStoreValue,
}));

vi.mock("../../services/tauri/agents", () => ({
  listAgentConfigs,
  listBuiltInAgents,
}));

function builtInCatalog(enabled: boolean) {
  return {
    providerId: "agency-agents",
    displayName: "Agency Agents",
    sourceUrl: "https://github.com/msitarzewski/agency-agents",
    sourceRevision: "revision",
    license: "MIT",
    divisions: [
      {
        id: "design",
        order: 1,
        count: 1,
        enabledCount: enabled ? 1 : 0,
        icon: "palette",
        color: "#2563eb",
        label: "设计",
        labelEn: "Design",
      },
    ],
    agents: [
      {
        id: "agency-agents:design/design-ui-designer",
        providerId: "agency-agents",
        divisionId: "design",
        name: "UI 设计师",
        nameEn: "UI Designer",
        description: "界面设计专家",
        descriptionEn: "Interface design expert",
        color: "#2563eb",
        emoji: "🎨",
        sourcePath: "design/design-ui-designer.md",
        sourceRevision: "revision",
        promptHash: "hash",
        enabled,
      },
    ],
  };
}

describe("useSelectedAgentSession", () => {
  beforeEach(() => {
    Object.keys(appStore).forEach((key) => delete appStore[key]);
    getClientStoreSync.mockClear();
    writeClientStoreValue.mockClear();
    listAgentConfigs.mockClear();
    listBuiltInAgents.mockReset();
    listBuiltInAgents.mockResolvedValue(builtInCatalog(false));
  });

  it("does not repeat the same pending-to-finalized selected agent migration", async () => {
    const resolveCanonicalThreadId = (threadId: string) =>
      threadId === "claude-pending-1" ? "claude:session-1" : threadId;
    appStore["composer.selectedAgentByThread.ws-a:claude-pending-1"] = {
      id: "backend",
      name: "Backend",
      prompt: "focus backend",
    };

    const { result, rerender } = renderHook(
      ({ activeThreadId }: { activeThreadId: string }) =>
        useSelectedAgentSession({
          activeWorkspaceId: "ws-a",
          activeThreadId,
          resolveCanonicalThreadId,
        }),
      {
        initialProps: { activeThreadId: "claude-pending-1" },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedAgent?.id).toBe("backend");
    });
    writeClientStoreValue.mockClear();

    rerender({ activeThreadId: "claude:session-1" });

    await waitFor(() => {
      expect(result.current.selectedAgent?.id).toBe("backend");
    });
    expect(writeClientStoreValue).toHaveBeenCalledTimes(1);
    expect(writeClientStoreValue).toHaveBeenLastCalledWith(
      "app",
      "composer.selectedAgentByThread.ws-a:claude:session-1",
      expect.objectContaining({ id: "backend", name: "Backend" }),
    );

    rerender({ activeThreadId: "claude:session-1" });

    await waitFor(() => {
      expect(result.current.selectedAgent?.id).toBe("backend");
    });
    expect(writeClientStoreValue).toHaveBeenCalledTimes(1);
  });

  it("keeps the reload callback stable while hydrating a persisted selection", async () => {
    appStore["composer.selectedAgentByThread.ws-a:claude:session-1"] = {
      id: "backend",
      name: "Backend",
      prompt: "focus backend",
    };
    const reloadCallbacks = new Set<() => void>();

    function Probe() {
      const session = useSelectedAgentSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "claude:session-1",
        resolveCanonicalThreadId: (threadId) => threadId,
      });
      reloadCallbacks.add(session.reloadSelectedAgent);
      return <div data-testid="selected-agent">{session.selectedAgent?.id ?? ""}</div>;
    }

    const view = render(<Probe />);

    await waitFor(() => {
      expect(view.getByTestId("selected-agent").textContent).toBe("backend");
    });
    expect(reloadCallbacks.size).toBe(1);
  });

  it("converges when built-in catalog readiness overlaps pending thread finalization", async () => {
    const pendingStorageKey =
      "composer.selectedAgentByThread.ws-a:claude-pending-1";
    const canonicalStorageKey =
      "composer.selectedAgentByThread.ws-a:claude:session-1";
    const persistedBuiltInAgent = {
      id: "agency-agents:design/design-ui-designer",
      name: "UI 设计师",
      prompt: null,
      source: "builtIn" as const,
      divisionId: "design",
      divisionLabel: "设计",
      sourceRevision: "revision",
      promptHash: "hash",
    };
    appStore[pendingStorageKey] = persistedBuiltInAgent;

    let resolveCatalog: ((catalog: ReturnType<typeof builtInCatalog>) => void) | null = null;
    listBuiltInAgents.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );
    const resolveCanonicalThreadId = (threadId: string) =>
      threadId === "claude-pending-1" ? "claude:session-1" : threadId;
    const { result, rerender } = renderHook(
      ({ activeThreadId }: { activeThreadId: string }) =>
        useSelectedAgentSession({
          activeWorkspaceId: "ws-a",
          activeThreadId,
          resolveCanonicalThreadId,
        }),
      {
        initialProps: { activeThreadId: "claude-pending-1" },
        wrapper: StrictMode,
      },
    );

    await waitFor(() => {
      expect(result.current.selectedAgent?.id).toBe(persistedBuiltInAgent.id);
    });
    const catalogReload = result.current.reloadAgentCatalog();
    writeClientStoreValue.mockClear();

    rerender({ activeThreadId: "claude:session-1" });
    await act(async () => {
      resolveCatalog?.(builtInCatalog(true));
      await catalogReload;
    });

    await waitFor(() => {
      expect(result.current.selectedAgent?.id).toBe(persistedBuiltInAgent.id);
    });
    expect(appStore[canonicalStorageKey]).toEqual(
      expect.objectContaining({ id: persistedBuiltInAgent.id }),
    );
    expect(
      writeClientStoreValue.mock.calls.filter(([, key]) => key === canonicalStorageKey),
    ).toHaveLength(1);
  });

  it("keeps a stored built-in selection until the catalog has loaded", async () => {
    const storageKey =
      "composer.selectedAgentByThread.ws-a:claude:session-1";
    appStore[storageKey] = {
      id: "agency-agents:design/design-ui-designer",
      name: "UI 设计师",
      prompt: null,
      source: "builtIn",
      divisionId: "design",
      divisionLabel: "设计",
      sourceRevision: "revision",
      promptHash: "hash",
    };

    const { result } = renderHook(() =>
      useSelectedAgentSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "claude:session-1",
        resolveCanonicalThreadId: (threadId) => threadId,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedAgent?.id).toBe(
        "agency-agents:design/design-ui-designer",
      );
    });
    expect(appStore[storageKey]).toEqual(
      expect.objectContaining({
        id: "agency-agents:design/design-ui-designer",
      }),
    );
  });

  it("clears a stored built-in selection after the catalog confirms it is disabled", async () => {
    const storageKey =
      "composer.selectedAgentByThread.ws-a:claude:session-1";
    appStore[storageKey] = {
      id: "agency-agents:design/design-ui-designer",
      name: "UI 设计师",
      prompt: null,
      source: "builtIn",
      divisionId: "design",
      divisionLabel: "设计",
      sourceRevision: "revision",
      promptHash: "hash",
    };

    const { result } = renderHook(() =>
      useSelectedAgentSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "claude:session-1",
        resolveCanonicalThreadId: (threadId) => threadId,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedAgent?.id).toBe(
        "agency-agents:design/design-ui-designer",
      );
    });

    await act(async () => {
      await result.current.reloadAgentCatalog();
    });

    await waitFor(() => {
      expect(result.current.selectedAgent).toBeNull();
    });
    expect(appStore[storageKey]).toBeNull();
  });
});
