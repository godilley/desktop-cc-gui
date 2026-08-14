import { invoke } from "@tauri-apps/api/core";
import {
  ALL_CLIENT_STORES,
  normalizeClientStoreSnapshot,
  serializeClientStoreSnapshot,
  type ClientStoreName,
} from "./clientStorageSchema";
import { recordHotspotSample } from "./perfBaseline/hotspotTracker";

const cache: Partial<Record<ClientStoreName, Record<string, unknown>>> = {};

let preloaded = false;

const WRITE_DEBOUNCE_MS = 300;
const pendingTimers: Partial<Record<ClientStoreName, ReturnType<typeof setTimeout>>> = {};
const dirtyKeys: Partial<Record<ClientStoreName, Set<string>>> = {};
const pendingFullReplace: Partial<Record<ClientStoreName, boolean>> = {};
const writeChainByStore: Partial<Record<ClientStoreName, Promise<void>>> = {};

const loadedStores = new Set<ClientStoreName>();
const inFlightStoreLoads: Partial<Record<ClientStoreName, Promise<void>>> = {};

async function loadStoreIntoCache(store: ClientStoreName): Promise<void> {
  try {
    const raw = await invoke<unknown>("client_store_read", { store });
    const normalized = normalizeClientStoreSnapshot(raw);
    if (normalized.recoveryReason) {
      queueMicrotask(() => {
        writeClientStoreData(store, normalized.data, { immediate: true });
      });
    }
    cache[store] = normalized.data;
  } catch {
    cache[store] = {};
  }
  loadedStores.add(store);
}

/**
 * Load a single client store into the in-memory cache. Idempotent and
 * de-duplicated: concurrent callers share one in-flight read, and a store
 * already loaded (here or via {@link preloadClientStores}) resolves instantly.
 * Lets early consumers (e.g. i18n startup) read the store they need without
 * waiting on the full preload.
 */
export async function loadClientStore(store: ClientStoreName): Promise<void> {
  if (loadedStores.has(store)) {
    return;
  }
  const existing = inFlightStoreLoads[store];
  if (existing) {
    return existing;
  }
  const load = loadStoreIntoCache(store).finally(() => {
    delete inFlightStoreLoads[store];
  });
  inFlightStoreLoads[store] = load;
  return load;
}

export async function preloadClientStores(): Promise<void> {
  if (preloaded) {
    return;
  }
  await Promise.all(ALL_CLIENT_STORES.map((store) => loadClientStore(store)));
  preloaded = true;
}

export function isPreloaded(): boolean {
  return preloaded;
}

export function resetClientStorageForTests(): void {
  preloaded = false;
  loadedStores.clear();
  for (const store of ALL_CLIENT_STORES) {
    delete cache[store];
    delete inFlightStoreLoads[store];
    if (pendingTimers[store] != null) {
      clearTimeout(pendingTimers[store]);
      delete pendingTimers[store];
    }
    delete dirtyKeys[store];
    delete pendingFullReplace[store];
    delete writeChainByStore[store];
  }
}

export function getClientStoreSync<T = unknown>(
  store: ClientStoreName,
  key: string,
): T | undefined {
  const storeData = cache[store];
  if (!storeData) {
    return undefined;
  }
  return storeData[key] as T | undefined;
}

export function getClientStoreFullSync<T = Record<string, unknown>>(
  store: ClientStoreName,
): T | undefined {
  return cache[store] as T | undefined;
}

export function writeClientStoreValue(
  store: ClientStoreName,
  key: string,
  value: unknown,
  options?: { immediate?: boolean },
): void {
  if (!cache[store]) {
    cache[store] = {};
  }
  cache[store]![key] = value;
  if (!dirtyKeys[store]) {
    dirtyKeys[store] = new Set();
  }
  dirtyKeys[store]!.add(key);
  if (options?.immediate) {
    flushStoreWrite(store);
    return;
  }
  scheduleDiskWrite(store);
}

export function writeClientStoreData(
  store: ClientStoreName,
  data: Record<string, unknown>,
  options?: { immediate?: boolean },
): void {
  cache[store] = data;
  pendingFullReplace[store] = true;
  dirtyKeys[store] = new Set(Object.keys(data));
  if (options?.immediate) {
    flushStoreWrite(store);
    return;
  }
  scheduleDiskWrite(store);
}

function scheduleDiskWrite(store: ClientStoreName): void {
  if (pendingTimers[store] != null) {
    clearTimeout(pendingTimers[store]);
  }
  pendingTimers[store] = setTimeout(() => {
    delete pendingTimers[store];
    flushStoreWrite(store);
  }, WRITE_DEBOUNCE_MS);
}

function flushStoreWrite(store: ClientStoreName): void {
  if (pendingTimers[store] != null) {
    clearTimeout(pendingTimers[store]);
    delete pendingTimers[store];
  }

  const shouldFullReplace = pendingFullReplace[store] === true;
  pendingFullReplace[store] = false;
  const dirtySnapshot = new Set(dirtyKeys[store] ?? []);
  if (dirtyKeys[store]) {
    for (const key of dirtySnapshot) {
      dirtyKeys[store]!.delete(key);
    }
  }
  const cacheSnapshot = cache[store] ?? {};
  const valueSnapshot: Record<string, unknown> = {};
  for (const key of dirtySnapshot) {
    valueSnapshot[key] = cacheSnapshot[key];
  }
  const fullDataSnapshot = shouldFullReplace ? { ...cacheSnapshot } : null;

  const nextWrite = async () => {
    // 只统计同步部分(序列化 + IPC marshaling),这才是占用主线程、可能造成掉帧的开销;
    // await 之后的等待发生在 Rust 侧,不阻塞渲染。
    const syncStartedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let pendingInvoke: Promise<unknown>;
    if (shouldFullReplace && fullDataSnapshot) {
      pendingInvoke = invoke("client_store_write", {
        store,
        data: serializeClientStoreSnapshot(fullDataSnapshot),
      });
    } else {
      pendingInvoke = invoke("client_store_patch", {
        store,
        patch: serializeClientStoreSnapshot(valueSnapshot),
      });
    }
    recordHotspotSample(
      "client-store-write",
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        syncStartedAt,
      `${store}:${shouldFullReplace ? "full" : [...dirtySnapshot].slice(0, 3).join(",")}`,
    );
    await pendingInvoke;
  };

  writeChainByStore[store] = (writeChainByStore[store] ?? Promise.resolve())
    .then(nextWrite)
    .catch((error) => {
      if (!dirtyKeys[store]) {
        dirtyKeys[store] = new Set();
      }
      for (const key of dirtySnapshot) {
        dirtyKeys[store]!.add(key);
      }
      if (shouldFullReplace) {
        pendingFullReplace[store] = true;
      }
      scheduleDiskWrite(store);
      if (typeof console !== "undefined") {
        console.error(`Failed to write client store "${store}":`, error);
      }
    });
}
