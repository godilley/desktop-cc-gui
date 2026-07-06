import type { ConversationItem, RequestUserInputRequest } from "../../../types";
import type { PresentationProfile } from "../presentation/presentationProfile";
import { shouldHideToolItemForRender } from "../utils/groupToolItems";
import type { MessagesEngine } from "./messagesRenderUtils";
import {
  countRenderableCollapsedEntries,
  scrollKeyForItems,
  toConversationEngine,
} from "./messagesRenderUtils";
import {
  collapseConsecutiveReasoningRuns,
  dedupeAdjacentReasoningItems,
  isExplicitReasoningSegmentId,
  parseReasoning,
} from "./messagesReasoning";
import {
  isMessageConversationItem,
  isUserMessageConversationItem,
} from "./messageItemPredicates";

export type MessageActionTargets = {
  targetByAssistantId: Map<string, string>;
  copyTextByAssistantId: Map<string, string>;
  latestFinalAssistantMessageId: string | null;
};

export type HistoryExpansionScrollSnapshot = {
  scrollHeight: number;
  scrollTop: number;
};

export type PreservedReadableWindow = {
  threadId: string | null;
  turnId: string | null;
  renderedItems: ConversationItem[];
  visibleCollapsedHistoryItemCount: number;
};

export type CollapsedTimelineItemsResult = {
  timelineItems: ConversationItem[];
  collapsedMiddleStepCount: number;
};

export function findItemById(items: ConversationItem[], itemId: string | null) {
  if (!itemId) {
    return null;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.id === itemId) {
      return item;
    }
  }
  return null;
}

export function readHistoryExpansionScrollSnapshot(
  container: HTMLDivElement | null,
): HistoryExpansionScrollSnapshot | null {
  if (!container) {
    return null;
  }
  const { scrollHeight, scrollTop } = container;
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(scrollTop)) {
    return null;
  }
  return { scrollHeight, scrollTop };
}

export function restoreHistoryExpansionScrollPosition(
  container: HTMLDivElement,
  snapshot: HistoryExpansionScrollSnapshot,
) {
  const currentScrollHeight = container.scrollHeight;
  if (!Number.isFinite(currentScrollHeight)) {
    return false;
  }
  const scrollHeightDelta = currentScrollHeight - snapshot.scrollHeight;
  const nextScrollTop = snapshot.scrollTop + scrollHeightDelta;
  if (!Number.isFinite(nextScrollTop)) {
    return false;
  }
  container.scrollTop = Math.max(0, nextScrollTop);
  return true;
}

export function findLatestAssistantTextLength(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "assistant") {
      continue;
    }
    return item.text.length;
  }
  return 0;
}

export function mergeReadableRecoveryItems(
  preservedItems: ConversationItem[],
  currentItems: ConversationItem[],
) {
  if (currentItems.length === 0) {
    return preservedItems;
  }
  const preservedItemIds = new Set(preservedItems.map((item) => item.id));
  const appendedCurrentItems = currentItems.filter((item) => !preservedItemIds.has(item.id));
  return appendedCurrentItems.length > 0
    ? [...preservedItems, ...appendedCurrentItems]
    : preservedItems;
}

export function buildMessageActionTargets(items: ConversationItem[]): MessageActionTargets {
  const targetByAssistantId = new Map<string, string>();
  const copyTextByAssistantId = new Map<string, string>();
  let latestUserMessageId: string | null = null;
  let latestFinalAssistantMessageId: string | null = null;
  let assistantTurnTextParts: string[] = [];
  for (const item of items) {
    if (item.kind !== "message") {
      continue;
    }
    if (item.role === "user") {
      latestUserMessageId = item.id;
      assistantTurnTextParts = [];
      continue;
    }
    if (item.role !== "assistant") {
      continue;
    }
    if (latestUserMessageId) {
      targetByAssistantId.set(item.id, latestUserMessageId);
    }
    assistantTurnTextParts.push(item.text);
    if (item.isFinal === true) {
      latestFinalAssistantMessageId = item.id;
      copyTextByAssistantId.set(item.id, assistantTurnTextParts.join("\n\n"));
      assistantTurnTextParts = [];
    }
  }
  return {
    targetByAssistantId,
    copyTextByAssistantId,
    latestFinalAssistantMessageId,
  };
}

export function resolveActiveUserInputRequest(options: {
  requests: RequestUserInputRequest[];
  threadId: string | null;
  workspaceId: string | null | undefined;
}) {
  const { requests, threadId, workspaceId } = options;
  if (!threadId || requests.length === 0) {
    return null;
  }
  return requests.find(
    (request) =>
      request.params.thread_id === threadId &&
      (!workspaceId || request.workspace_id === workspaceId),
  ) ?? null;
}

export function buildMessagesScrollKey(
  items: ConversationItem[],
  activeUserInputRequestId: string | number | null,
) {
  return `${scrollKeyForItems(items)}-${activeUserInputRequestId ?? "no-input"}`;
}

export function isMessagesScrollNearBottom(node: HTMLDivElement, thresholdPx: number) {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= thresholdPx;
}

export function resolveActiveMessageAnchor(
  container: HTMLDivElement | null,
  messageNodeById: Map<string, HTMLDivElement>,
) {
  if (!container) {
    return null;
  }
  // Probe at the viewport CENTRE, not a shallow top offset. The active anchor is
  // the last user message whose top has scrolled above the middle of the screen
  // (scroll-spy). A centre probe stays reachable for the whole conversation tail;
  // a shallow top probe does not — you hit max scroll before the final messages
  // can reach it, which is why the last few never used to highlight.
  const viewportProbeY = container.scrollTop + container.clientHeight / 2;
  let activeId: string | null = null;
  let activeTop = Number.NEGATIVE_INFINITY;
  let firstId: string | null = null;
  let firstTop = Number.POSITIVE_INFINITY;
  for (const [messageId, node] of messageNodeById) {
    const top = node.offsetTop;
    if (top <= viewportProbeY && top > activeTop) {
      activeTop = top;
      activeId = messageId;
    }
    if (top < firstTop) {
      firstTop = top;
      firstId = messageId;
    }
  }
  // Scrolled above the first anchor's midpoint → the first anchor is active.
  return activeId ?? firstId;
}

export function resolveVisibleMessageItems(options: {
  items: ConversationItem[];
  activeEngine: MessagesEngine;
  hideClaudeReasoning: boolean;
  latestTitleOnlyReasoningId: string | null;
  presentationProfile: PresentationProfile | null;
  reasoningMetaById: Map<string, ReturnType<typeof parseReasoning>>;
}) {
  const {
    items,
    activeEngine,
    hideClaudeReasoning,
    latestTitleOnlyReasoningId,
    presentationProfile,
    reasoningMetaById,
  } = options;
  const filtered = items.filter((item) => {
    if (
      (activeEngine === "codex" || activeEngine === "claude") &&
      item.kind === "explore" &&
      item.status === "exploring"
    ) {
      return false;
    }
    if (hideClaudeReasoning && item.kind === "reasoning") {
      return false;
    }
    if (item.kind === "tool" && shouldHideToolItemForRender(item)) {
      return false;
    }
    if (item.kind !== "reasoning") {
      return true;
    }
    const parsed = reasoningMetaById.get(item.id);
    const hasBody = parsed?.hasBody ?? false;
    if (hasBody) {
      return true;
    }
    if (!parsed?.workingLabel) {
      return false;
    }
    if (activeEngine === "gemini" && isExplicitReasoningSegmentId(item.id)) {
      return true;
    }
    if (activeEngine === "claude") {
      return true;
    }
    const keepTitleOnlyReasoning = presentationProfile
      ? presentationProfile.showReasoningLiveDot
      : activeEngine === "codex";
    return keepTitleOnlyReasoning || item.id === latestTitleOnlyReasoningId;
  });
  const appendReasoningRuns = activeEngine === "claude" || activeEngine === "gemini";
  const deduped = dedupeAdjacentReasoningItems(
    filtered,
    reasoningMetaById,
    appendReasoningRuns,
    toConversationEngine(activeEngine),
  );
  const collapseReasoningRuns = activeEngine !== "codex";
  return collapseConsecutiveReasoningRuns(
    deduped,
    collapseReasoningRuns,
    appendReasoningRuns,
  );
}

export function resolveCollapsedTimelineItems(options: {
  activeEngine: MessagesEngine;
  collapseLiveMiddleStepsEnabled: boolean;
  isThinking: boolean;
  latestAssistantMessageId: string | null;
  latestReasoningId: string | null;
  timelineSourceItems: ConversationItem[];
}): CollapsedTimelineItemsResult {
  const {
    activeEngine,
    collapseLiveMiddleStepsEnabled,
    isThinking,
    latestAssistantMessageId,
    latestReasoningId,
    timelineSourceItems,
  } = options;
  if (!collapseLiveMiddleStepsEnabled || timelineSourceItems.length <= 2) {
    return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
  }
  if (!isThinking) {
    return resolveSettledCollapsedTimelineItems(timelineSourceItems, activeEngine);
  }
  return resolveLiveCollapsedTimelineItems({
    activeEngine,
    latestAssistantMessageId,
    latestReasoningId,
    timelineSourceItems,
  });
}

function resolveSettledCollapsedTimelineItems(
  timelineSourceItems: ConversationItem[],
  activeEngine: MessagesEngine,
): CollapsedTimelineItemsResult {
  const firstUserIndex = timelineSourceItems.findIndex(
    (item) => item.kind === "message" && item.role === "user",
  );
  if (firstUserIndex < 0) {
    return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
  }
  let lastMessageIndex = -1;
  for (let index = timelineSourceItems.length - 1; index >= 0; index -= 1) {
    if (timelineSourceItems[index]?.kind === "message") {
      lastMessageIndex = index;
      break;
    }
  }
  if (lastMessageIndex <= firstUserIndex) {
    return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
  }
  const nextTimelineItems: ConversationItem[] = [];
  const hiddenItems: ConversationItem[] = [];
  for (let index = 0; index < timelineSourceItems.length; index += 1) {
    const item = timelineSourceItems[index];
    if (!item) {
      continue;
    }
    if (index < firstUserIndex || index > lastMessageIndex || isMessageConversationItem(item)) {
      nextTimelineItems.push(item);
      continue;
    }
    hiddenItems.push(item);
  }
  const collapsedEntryCount = countRenderableCollapsedEntries(hiddenItems, activeEngine);
  return hiddenItems.length > 0
    ? { timelineItems: nextTimelineItems, collapsedMiddleStepCount: collapsedEntryCount }
    : { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
}

function resolveLiveCollapsedTimelineItems(options: {
  activeEngine: MessagesEngine;
  latestAssistantMessageId: string | null;
  latestReasoningId: string | null;
  timelineSourceItems: ConversationItem[];
}): CollapsedTimelineItemsResult {
  const {
    activeEngine,
    latestAssistantMessageId,
    latestReasoningId,
    timelineSourceItems,
  } = options;
  let lastUserIndex = -1;
  for (let index = timelineSourceItems.length - 1; index >= 0; index -= 1) {
    const candidate = timelineSourceItems[index];
    if (isUserMessageConversationItem(candidate)) {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0 || lastUserIndex >= timelineSourceItems.length - 2) {
    return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
  }
  const lastIndex = timelineSourceItems.length - 1;
  const nextTimelineItems: ConversationItem[] = [];
  const hiddenItems: ConversationItem[] = [];
  for (let index = 0; index < timelineSourceItems.length; index += 1) {
    const item = timelineSourceItems[index];
    if (!item) {
      continue;
    }
    const shouldKeepLatestClaudeReasoningVisible =
      activeEngine === "claude"
      && latestAssistantMessageId === null
      && latestReasoningId !== null
      && item.kind === "reasoning"
      && item.id === latestReasoningId;
    if (index <= lastUserIndex || index === lastIndex) {
      nextTimelineItems.push(item);
      continue;
    }
    if (isMessageConversationItem(item)) {
      nextTimelineItems.push(item);
      continue;
    }
    if (shouldKeepLatestClaudeReasoningVisible) {
      nextTimelineItems.push(item);
      continue;
    }
    hiddenItems.push(item);
  }
  const collapsedEntryCount = countRenderableCollapsedEntries(hiddenItems, activeEngine);
  return hiddenItems.length > 0
    ? { timelineItems: nextTimelineItems, collapsedMiddleStepCount: collapsedEntryCount }
    : { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
}
