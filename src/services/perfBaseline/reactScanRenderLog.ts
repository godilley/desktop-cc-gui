// react-scan 渲染日志(MON-3)。
//
// 生产版 React 被 react-scan 剥离 per-render 计时,只能拿到"谁渲染了、渲染几次"。本模块
// 通过 react-scan 的 onRender 回调把每次 commit 的组件渲染记进环形缓冲,掉帧监视器在掉帧
// 瞬间读取"掉帧前一小段时间里渲染最多的组件",回答"是谁在重渲染"。仅当 react-scan overlay
// 开启时才有数据(onRender 由 reactScanController 接入)。

type RenderLogEntry = {
  name: string;
  count: number;
  // Summed self-time (ms) across this commit's Render objects. react-scan puts
  // per-render self-time on Render.time; we were discarding it. May be 0/absent
  // in production builds (React strips per-render timings there).
  selfMs: number;
  at: number;
};

const MAX_ENTRIES = 300;
const buffer: RenderLogEntry[] = [];

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// react-scan 传入的 fiber.type 可能是 function / class / 字符串 / memo / forwardRef 包装,
// 尽力提取一个可读组件名,失败返回 "unknown"。
function getFiberName(fiber: unknown): string {
  const type = (fiber as { type?: unknown } | null | undefined)?.type;
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || "anonymous";
  }
  if (typeof type === "string") {
    return type;
  }
  if (type && typeof type === "object") {
    const wrapper = type as {
      displayName?: string;
      type?: unknown;
      render?: unknown;
    };
    if (wrapper.displayName) {
      return wrapper.displayName;
    }
    const inner = wrapper.type ?? wrapper.render;
    if (typeof inner === "function") {
      const innerFn = inner as { displayName?: string; name?: string };
      return innerFn.displayName || innerFn.name || "memo";
    }
  }
  return "unknown";
}

// Sum the self-time off react-scan's Render[] payload (each has a numeric `time`).
function sumSelfMs(renders: unknown): number {
  if (!Array.isArray(renders)) {
    return 0;
  }
  let total = 0;
  for (const render of renders) {
    const time = (render as { time?: unknown } | null | undefined)?.time;
    if (typeof time === "number" && Number.isFinite(time)) {
      total += time;
    }
  }
  return total;
}

export function recordReactScanRender(fiber: unknown, renders: unknown): void {
  const name = getFiberName(fiber);
  const count = Array.isArray(renders) ? renders.length : 1;
  buffer.push({ name, count, selfMs: sumSelfMs(renders), at: nowMs() });
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

/**
 * 返回最近 windowMs 内渲染次数最多的前若干组件,供掉帧现场附着。
 * selfMs 为该窗口内该组件的累计 self-time(生产版可能恒为 0)。
 */
export function getRecentReactScanRenderSummary(
  windowMs = 600,
): Array<{ name: string; count: number; selfMs: number }> {
  const cutoff = nowMs() - windowMs;
  const aggregated = new Map<string, { count: number; selfMs: number }>();
  for (const entry of buffer) {
    if (entry.at >= cutoff) {
      const prev = aggregated.get(entry.name) ?? { count: 0, selfMs: 0 };
      prev.count += entry.count;
      prev.selfMs += entry.selfMs;
      aggregated.set(entry.name, prev);
    }
  }
  return [...aggregated.entries()]
    .map(([name, { count, selfMs }]) => ({
      name,
      count,
      // Round to keep the exported JSON compact.
      selfMs: Math.round(selfMs * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export function __resetReactScanRenderLogForTests(): void {
  buffer.length = 0;
}
