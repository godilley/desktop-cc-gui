import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import type {
  AccessMode,
  ConversationItem,
  QueuedMessage,
} from "../../../types";
import type { StreamMitigationProfile } from "../../threads/utils/streamLatencyDiagnostics";
import type { GroupedEntry } from "../utils/groupToolItems";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import type { PresentationProfile } from "../presentation/presentationProfile";
import { Marker } from "../../../components/ui/marker";
import {
  ToolBlockRenderer,
  ReadToolGroupBlock,
  EditToolGroupBlock,
  BashToolGroupBlock,
  SearchToolGroupBlock,
} from "./toolBlocks";
import {
  DiffRow,
  ExploreRow,
  GeneratedImageRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  WorkingIndicator,
} from "./MessagesRows";
import { ConversationRowErrorBoundary } from "./ConversationRowErrorBoundary";
import { MessagesOutlineFloater } from "./MessagesOutlineFloater";
import type { MarkdownOutlineEntry } from "../../markdown/fastMarkdownRenderer";
import { useMessageOutlineActive } from "../hooks/useMessageOutlineActive";
import {
  resolveNextMessageOutlineSnapshot,
  type MessageOutlineSnapshot,
} from "./messagesOutlineState";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import {
  appendReasoningRunText,
  compactComparableReasoningText,
  parseReasoning,
} from "./messagesReasoning";
import type { RuntimeReconnectRecoveryCallbackResult } from "./runtimeReconnect";
import type { MessagesPresentationMode } from "./messagesLiveWindow";
import {
  formatCompletedTimeMs,
  type MessagesEngine,
  resolveProvenanceEngineLabel,
  shouldHideCodexCanvasCommandCard,
} from "./messagesRenderUtils";
import { resolveUserMessagePresentation } from "./messagesUserPresentation";
import {
  buildTimelineProjectionRows,
  findTimelineProjectionRowIndexByItemId,
  groupedEntryContainsItemId,
  type TimelineProjectionRow,
} from "./messagesTimelineProjection";
import {
  countHydratedHeavyTimelineRows,
  deriveTimelineRowHydrationStates,
  type TimelineRowHydrationState,
} from "./messagesTimelineHydration";
import {
  resolveConversationLightweightModeState,
  resolveConversationLightweightPolicy,
} from "./messagesConversationLightweightMode";
import {
  buildTimelineRenderWeightDiagnosticPayload,
  classifyTimelineVirtualizerStability,
  DEFAULT_TIMELINE_VIRTUALIZER_STABILITY_RECOVERY_BUDGET,
  estimateTimelineProjectionRowSize,
  getActiveLiveTimelineRowKeys,
  getTimelineVirtualizationThresholdReason,
  isEmptyVirtualProjectionRow,
  observeTimelineElementOffset,
  remeasureTimelineVirtualizerRows,
  resolveTimelineCanvasOverscan,
  resolveTimelineVirtualizerStabilityRecovery,
  TIMELINE_LIGHTWEIGHT_ROW_PLACEHOLDER_HEIGHT,
  resolveVirtualizedTimelineRowVisualHeight,
  resolveVirtualizedTimelineScopeReset,
  shouldVirtualizeTimelineRows,
  summarizeTimelineProjectionRenderWeight,
} from "./messagesTimelineVirtualization";
import {
  DEFAULT_HYDRATION_REMEASURE_BUDGET,
  resolveHydrationRemeasureGuard,
  type HydrationRemeasureBudget,
} from "./messagesRenderLoopGuards";

// ponytail: bottom-right outline floater hidden by product decision (2026-07-03).
// Flip to true to restore. Gating the outline at both consumers below also
// disables useMessageOutlineActive's window scroll/resize listener, so no
// per-scroll setState fires while the floater is hidden.
const SHOW_OUTLINE_FLOATER = false;

const TIMELINE_VIRTUALIZER_STABILITY_REMEASURE_COOLDOWN_MS = 750;
const TIMELINE_VIRTUALIZER_STABILITY_DIAGNOSTIC_COOLDOWN_MS = 5_000;
const TIMELINE_RENDER_WEIGHT_DIAGNOSTIC_COOLDOWN_MS = 5_000;
const TIMELINE_HYDRATION_REMEASURE_DIAGNOSTIC_COOLDOWN_MS = 5_000;
const CONVERSATION_LIGHTWEIGHT_DIAGNOSTIC_COOLDOWN_MS = 5_000;
const TIMELINE_LIVE_ROW_BOTTOM_PROXIMITY_PX = 720;
const TIMELINE_SCROLL_DIAGNOSTIC_MIN_INTERVAL_MS = 250;
const TIMELINE_SCROLL_DIAGNOSTIC_MIN_DELTA_PX = 24;

type TimelineScrollDiagnosticSnapshot = {
  clientHeight: number;
  distanceFromBottom: number;
  scrollHeight: number;
  scrollTop: number;
};

function collectTimelineScrollDiagnosticSnapshot(
  element: HTMLElement,
): TimelineScrollDiagnosticSnapshot {
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return {
    clientHeight: Math.round(element.clientHeight),
    distanceFromBottom: Math.round(distanceFromBottom),
    scrollHeight: Math.round(element.scrollHeight),
    scrollTop: Math.round(element.scrollTop),
  };
}

type MessagesTimelineProps = {
  activeCollaborationModeId: string | null;
  activeEngine: MessagesEngine;
  activeUserInputAnchorItemId: string | null;
  activeUserInputRequestId: string | number | null;
  agentTaskNodeByTaskIdRef: MutableRefObject<Map<string, HTMLDivElement>>;
  agentTaskNodeByToolUseIdRef: MutableRefObject<Map<string, HTMLDivElement>>;
  approvalNode: ReactNode;
  assistantFinalBoundarySet: Set<string>;
  assistantLiveTurnFinalBoundarySuppressedSet: Set<string>;
  bottomRef: RefObject<HTMLDivElement | null>;
  claudeDockedReasoningItems: Array<{
    item: Extract<ConversationItem, { kind: "reasoning" }>;
    parsed: ReturnType<typeof parseReasoning>;
  }>;
  collapseLiveMiddleStepsEnabled: boolean;
  collapsedMiddleStepCount: number;
  codeBlockCopyUseModifier: boolean;
  copiedMessageId: string | null;
  effectiveItemsCount: number;
  expandedItems: Set<string>;
  groupedEntries: GroupedEntry[];
  liveAssistantItem: Extract<ConversationItem, { kind: "message" }> | null;
  liveReasoningItem: Extract<ConversationItem, { kind: "reasoning" }> | null;
  handleCopyMessage: (
    item: Extract<ConversationItem, { kind: "message" }>,
    copyText?: string,
  ) => void;
  messageActionTargetByAssistantId: Map<string, string>;
  messageCopyTextByAssistantId: Map<string, string>;
  latestFinalAssistantMessageId: string | null;
  pendingJumpMessageId: string | null;
  onPendingJumpTargetReady: (messageId: string) => void;
  onForkFromMessage?: (messageId: string) => void;
  onRewindFromMessage?: (messageId: string) => void;
  handleExitPlanModeExecuteForItem: (
    itemId: string,
    mode: Extract<AccessMode, "default" | "full-access">,
  ) => Promise<void>;
  heartbeatPulse: number;
  hiddenClaudeReasoningOnly: boolean;
  isHistoryLoading: boolean;
  isThinking: boolean;
  isWorking: boolean;
  lastDurationMs: number | null;
  liveAssistantMessageId: string | null;
  latestReasoningLabel: string | null;
  latestReasoningId: string | null;
  latestRetryMessage: Pick<QueuedMessage, "text" | "images"> | null;
  latestRuntimeReconnectItemId: string | null;
  latestWorkingActivityLabel: string | null;
  liveAutoExpandedExploreId: string | null;
  conversationDetailHydrationRequested: boolean;
  conversationLightweightModeEnabled: boolean;
  messageNodeByIdRef: MutableRefObject<Map<string, HTMLDivElement>>;
  onOpenDiffPath?: (path: string) => void;
  onConversationDetailHydrationRequest: () => void;
  onConversationLightweightModeEnable: () => void;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onThreadRecoveryFork?: () => Promise<void> | void;
  onAssistantVisibleTextRender?: (payload: {
    itemId: string;
    visibleText: string;
  }) => void;
  onShowAllHistoryItems: () => void;
  openFileLink?: (path: string) => void;
  presentationProfile: PresentationProfile | null;
  primaryWorkingLabel: string | null;
  processingStartedAt: number | null;
  proxyEnabled: boolean;
  proxyUrl: string | null;
  reasoningMetaById: Map<string, ReturnType<typeof parseReasoning>>;
  requestAutoScroll: () => void;
  selectedExitPlanExecutionByItemKey: Record<string, Extract<AccessMode, "default" | "full-access">>;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  showFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
  streamMitigationProfile: StreamMitigationProfile | null;
  streamActivityPhase: "idle" | "waiting" | "ingress";
  suppressedUserMemoryContextMessageIds: Set<string>;
  suppressedUserNoteCardContextMessageIds: Set<string>;
  threadId: string | null;
  toggleExpanded: (id: string) => void;
  claudeHistoryTranscriptFallbackActive: boolean;
  hasVisibleUserInputRequest: boolean;
  historyExpansionActive: boolean;
  presentationMode: MessagesPresentationMode;
  presentationScopeKey: string;
  userInputNode: ReactNode;
  visibleCollapsedHistoryItemCount: number;
  waitingForFirstChunk: boolean;
  workspaceId: string | null | undefined;
};

type NormalizedRenderKind = ConversationItem["kind"];

function resolveNormalizedRenderKind(item: ConversationItem): NormalizedRenderKind {
  return item.kind;
}

function resolveLiveRenderItem(
  item: ConversationItem,
  liveAssistantItem: Extract<ConversationItem, { kind: "message" }> | null,
  liveReasoningItem: Extract<ConversationItem, { kind: "reasoning" }> | null,
  preserveMergedReasoningPrefix = false,
) {
  if (item.kind === "message" && liveAssistantItem?.id === item.id) {
    return liveAssistantItem;
  }
  if (item.kind === "reasoning" && liveReasoningItem?.id === item.id) {
    if (!preserveMergedReasoningPrefix) {
      return liveReasoningItem;
    }
    // timeline 条目可能是同段相邻思考的合并块；直播原始条目只有最后一段，
    // 直接替换会把前段文本顶掉。检测到前缀缺失时保留合并前缀、只刷新直播尾段。
    const compactTimeline = compactComparableReasoningText(
      item.content || item.summary || "",
    );
    const compactLive = compactComparableReasoningText(
      liveReasoningItem.content || liveReasoningItem.summary || "",
    );
    if (compactTimeline && !compactLive.includes(compactTimeline)) {
      return {
        ...liveReasoningItem,
        summary: appendReasoningRunText(item.summary, liveReasoningItem.summary),
        content: appendReasoningRunText(item.content, liveReasoningItem.content),
      };
    }
    return liveReasoningItem;
  }
  return item;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  activeCollaborationModeId,
  activeEngine,
  activeUserInputAnchorItemId,
  activeUserInputRequestId,
  agentTaskNodeByTaskIdRef,
  agentTaskNodeByToolUseIdRef,
  approvalNode,
  assistantFinalBoundarySet,
  assistantLiveTurnFinalBoundarySuppressedSet,
  bottomRef,
  claudeDockedReasoningItems,
  collapseLiveMiddleStepsEnabled,
  collapsedMiddleStepCount,
  codeBlockCopyUseModifier,
  copiedMessageId,
  effectiveItemsCount,
  expandedItems,
  groupedEntries,
  liveAssistantItem,
  liveReasoningItem,
  handleCopyMessage,
  messageActionTargetByAssistantId,
  messageCopyTextByAssistantId,
  latestFinalAssistantMessageId,
  pendingJumpMessageId,
  onPendingJumpTargetReady,
  onForkFromMessage,
  onRewindFromMessage,
  handleExitPlanModeExecuteForItem,
  heartbeatPulse,
  hiddenClaudeReasoningOnly,
  isHistoryLoading,
  isThinking,
  isWorking,
  lastDurationMs,
  liveAssistantMessageId,
  latestReasoningLabel,
  latestReasoningId,
  latestRetryMessage,
  latestRuntimeReconnectItemId,
  latestWorkingActivityLabel,
  liveAutoExpandedExploreId,
  conversationDetailHydrationRequested,
  conversationLightweightModeEnabled,
  messageNodeByIdRef,
  onOpenDiffPath,
  onConversationDetailHydrationRequest,
  onConversationLightweightModeEnable,
  onRecoverThreadRuntime,
  onRecoverThreadRuntimeAndResend,
  onThreadRecoveryFork,
  onAssistantVisibleTextRender,
  onShowAllHistoryItems,
  openFileLink,
  presentationProfile,
  primaryWorkingLabel,
  processingStartedAt,
  proxyEnabled,
  proxyUrl,
  reasoningMetaById,
  requestAutoScroll,
  selectedExitPlanExecutionByItemKey,
  scrollElementRef,
  showFileLinkMenu,
  streamMitigationProfile,
  streamActivityPhase,
  suppressedUserMemoryContextMessageIds,
  suppressedUserNoteCardContextMessageIds,
  threadId,
  toggleExpanded,
  claudeHistoryTranscriptFallbackActive,
  hasVisibleUserInputRequest,
  historyExpansionActive,
  presentationMode,
  presentationScopeKey,
  userInputNode,
  visibleCollapsedHistoryItemCount,
  waitingForFirstChunk,
  workspaceId,
}: MessagesTimelineProps) {
  const { t } = useTranslation();
  const [currentOutline, setCurrentOutline] = useState<MessageOutlineSnapshot | null>(null);
  const handleLiveOutlineReady = useCallback(
    (snapshot: MessageOutlineSnapshot) => {
      setCurrentOutline((previous) =>
        resolveNextMessageOutlineSnapshot(previous, snapshot),
      );
    },
    [],
  );
  const liveAssistantOutlineReady = useMemo(() => {
    if (!liveAssistantMessageId) {
      return undefined;
    }
    return (outline: MarkdownOutlineEntry[]) => {
      handleLiveOutlineReady({
        messageId: liveAssistantMessageId,
        outline,
      });
    };
  }, [handleLiveOutlineReady, liveAssistantMessageId]);
  const floaterContainerRef = useRef<HTMLDivElement | null>(null);
  const { activeHeadingId } = useMessageOutlineActive(
    SHOW_OUTLINE_FLOATER ? (currentOutline?.outline ?? null) : null,
    floaterContainerRef,
  );
  useEffect(() => {
    setCurrentOutline(null);
  }, [threadId, workspaceId]);
  const timelineStabilityRecoveryBudgetRef = useRef(
    DEFAULT_TIMELINE_VIRTUALIZER_STABILITY_RECOVERY_BUDGET,
  );
  const hydrationRemeasureBudgetRef = useRef<HydrationRemeasureBudget>(
    DEFAULT_HYDRATION_REMEASURE_BUDGET,
  );
  // lightweight / live 两套重测同样复用 budget guard：签名不变时封顶重测次数 +
  // cooldown，避免 measure→重排→ResizeObserver→再 measure 的回路造成持续闪动。
  const lightweightRemeasureBudgetRef = useRef<HydrationRemeasureBudget>(
    DEFAULT_HYDRATION_REMEASURE_BUDGET,
  );
  const liveRowRemeasureBudgetRef = useRef<HydrationRemeasureBudget>(
    DEFAULT_HYDRATION_REMEASURE_BUDGET,
  );
  const hydrationRemeasureRafRef = useRef<number | null>(null);
  const lightweightRemeasureRafRef = useRef<number | null>(null);
  const liveRowRemeasureRafRef = useRef<number | null>(null);
  const lastTimelineRenderWeightDiagnosticRef = useRef<{
    at: number;
    signature: string;
  }>({ at: 0, signature: "" });
  const lastConversationLightweightDiagnosticRef = useRef<{
    at: number;
    signature: string;
  }>({ at: 0, signature: "" });
  const lastTimelineScrollDiagnosticRef = useRef<{
    at: number;
    eventKind: string;
    snapshot: TimelineScrollDiagnosticSnapshot | null;
  }>({ at: 0, eventKind: "", snapshot: null });
  const retainedHydratedTimelineRowKeysRef = useRef<{
    scopeKey: string;
    rowKeys: Set<string>;
  }>({ scopeKey: "", rowKeys: new Set() });
  const lastVirtualizedTimelineScopeResetRef = useRef<string | null>(null);

  useEffect(() => {
    hydrationRemeasureBudgetRef.current = DEFAULT_HYDRATION_REMEASURE_BUDGET;
    lightweightRemeasureBudgetRef.current = DEFAULT_HYDRATION_REMEASURE_BUDGET;
    liveRowRemeasureBudgetRef.current = DEFAULT_HYDRATION_REMEASURE_BUDGET;
    if (typeof window !== "undefined" && hydrationRemeasureRafRef.current !== null) {
      window.cancelAnimationFrame(hydrationRemeasureRafRef.current);
      hydrationRemeasureRafRef.current = null;
    }
    if (typeof window !== "undefined" && liveRowRemeasureRafRef.current !== null) {
      window.cancelAnimationFrame(liveRowRemeasureRafRef.current);
      liveRowRemeasureRafRef.current = null;
    }
    if (typeof window !== "undefined" && lightweightRemeasureRafRef.current !== null) {
      window.cancelAnimationFrame(lightweightRemeasureRafRef.current);
      lightweightRemeasureRafRef.current = null;
    }
  }, [threadId, workspaceId]);

  const shouldRenderUserInputAtTail = Boolean(
    userInputNode &&
      (!activeUserInputAnchorItemId ||
        !groupedEntries.some((entry) =>
          groupedEntryContainsItemId(entry, activeUserInputAnchorItemId),
        )),
  );
  const approvalVisible = Boolean(approvalNode);
  const claudeDockedReasoningItemIds = useMemo(
    () => claudeDockedReasoningItems.map(({ item }) => item.id),
    [claudeDockedReasoningItems],
  );
  const timelineProjectionRows = useMemo(
    () =>
      buildTimelineProjectionRows({
        activeUserInputAnchorItemId,
        approvalVisible,
        claudeDockedReasoningItemIds,
        collapsedMiddleStepCount,
        collapseLiveMiddleStepsEnabled,
        effectiveItemsCount,
        groupedEntries,
        hasVisibleUserInputRequest,
        hiddenClaudeReasoningOnly,
        isHistoryLoading,
        isThinking,
        shouldRenderUserInputAtTail,
      }),
    [
      activeUserInputAnchorItemId,
      approvalVisible,
      claudeDockedReasoningItemIds,
      collapsedMiddleStepCount,
      collapseLiveMiddleStepsEnabled,
      effectiveItemsCount,
      groupedEntries,
      hasVisibleUserInputRequest,
      hiddenClaudeReasoningOnly,
      isHistoryLoading,
      isThinking,
      shouldRenderUserInputAtTail,
    ],
  );
  const timelineRowByKey = useMemo(
    () => new Map(timelineProjectionRows.map((row) => [row.key, row])),
    [timelineProjectionRows],
  );
  const dockedReasoningById = useMemo(
    () => new Map(claudeDockedReasoningItems.map((entry) => [entry.item.id, entry])),
    [claudeDockedReasoningItems],
  );
  const timelineRenderWeightSummary = useMemo(
    () => {
      if (isThinking || isWorking) {
        return {
          rowCount: timelineProjectionRows.length,
          renderWeight: timelineProjectionRows.length,
          heavyRowCount: 0,
          categoryCounts: {},
        };
      }
      return summarizeTimelineProjectionRenderWeight(timelineProjectionRows);
    },
    [isThinking, isWorking, timelineProjectionRows],
  );
  const conversationLightweightPolicy = useMemo(
    () => resolveConversationLightweightPolicy(timelineRenderWeightSummary),
    [timelineRenderWeightSummary],
  );
  const conversationLightweightModeState = useMemo(
    () =>
      resolveConversationLightweightModeState({
        policy: conversationLightweightPolicy,
        manualEnabled: conversationLightweightModeEnabled,
        detailHydrationRequested: conversationDetailHydrationRequested,
      }),
    [
      conversationDetailHydrationRequested,
      conversationLightweightModeEnabled,
      conversationLightweightPolicy,
    ],
  );
  const effectiveConversationLightweightMode = conversationLightweightModeState.active;
  const shouldVirtualizeTimelineByWeight = shouldVirtualizeTimelineRows({
    isThinking,
    rowCount: timelineProjectionRows.length,
    renderWeight: timelineRenderWeightSummary.renderWeight,
  });
  const shouldUseStaticExpandedHistoryFlow =
    historyExpansionActive &&
    !isThinking &&
    !isWorking &&
    !pendingJumpMessageId;
  const shouldUseStaticLightweightHistoryFlow =
    shouldUseStaticExpandedHistoryFlow &&
    !conversationDetailHydrationRequested &&
    (conversationLightweightPolicy.suggested || effectiveConversationLightweightMode);
  const shouldVirtualizeTimeline =
    shouldVirtualizeTimelineByWeight && !shouldUseStaticExpandedHistoryFlow;
  const shouldDeferHeavyTimelineRows =
    shouldVirtualizeTimelineByWeight || shouldUseStaticLightweightHistoryFlow;
  const activeLiveTimelineRowKeys = useMemo(
    () =>
      getActiveLiveTimelineRowKeys({
        rows: timelineProjectionRows,
        liveAssistantItemId: liveAssistantItem?.id ?? liveAssistantMessageId,
        liveReasoningItemId: liveReasoningItem?.id ?? latestReasoningId,
      }),
    [
      latestReasoningId,
      liveAssistantItem?.id,
      liveAssistantMessageId,
      liveReasoningItem?.id,
      timelineProjectionRows,
    ],
  );
  const activeLiveTimelineRowKeySet = useMemo(
    () => new Set(activeLiveTimelineRowKeys),
    [activeLiveTimelineRowKeys],
  );
  const pendingJumpRowIndex = useMemo(
    () =>
      pendingJumpMessageId
        ? findTimelineProjectionRowIndexByItemId(timelineProjectionRows, pendingJumpMessageId)
        : -1,
    [pendingJumpMessageId, timelineProjectionRows],
  );
  const pendingJumpRowKey = pendingJumpRowIndex >= 0
    ? timelineProjectionRows[pendingJumpRowIndex]?.key ?? null
    : null;
  const timelineVirtualizer = useVirtualizer({
    count: shouldVirtualizeTimeline ? timelineProjectionRows.length : 0,
    enabled: shouldVirtualizeTimeline,
    estimateSize: (index) => {
      const projectionRow = timelineProjectionRows[index];
      if (!projectionRow) {
        return estimateTimelineProjectionRowSize({
          kind: "bottomAnchor",
          key: "bottom-anchor",
        });
      }
      // 渲染为空的投影行（被跳过的工具卡、非工作态 working 指示等）视觉高度为 0；
      // 估高也必须归零。否则 measure() 重置后虚拟器会按 row.kind 估高（如 tool=58px）
      // 给这些空行预留布局偏移，在相邻两行之间撑出 phantom 间隙——这正是对话过程中
      // 时不时空一大段的根因（resizeItem(index,0) 会被后续 measure() 重置覆盖）。
      if (
        isEmptyVirtualProjectionRow(projectionRow, {
          activeEngine,
          claudeHistoryTranscriptFallbackActive,
          hasTailUserInputNode: Boolean(userInputNode),
          isWorking,
          lastDurationMs,
          effectiveItemsCount,
        })
      ) {
        return 0;
      }
      return estimateTimelineProjectionRowSize(projectionRow);
    },
    getItemKey: (index) => timelineProjectionRows[index]?.key ?? `missing:${index}`,
    getScrollElement: () => scrollElementRef.current,
    observeElementOffset: observeTimelineElementOffset,
    overscan: resolveTimelineCanvasOverscan({
      isThinking,
      isWorking,
      rowCount: timelineProjectionRows.length,
      renderWeight: timelineRenderWeightSummary.renderWeight,
    }),
  });
  const virtualTimelineRows = timelineVirtualizer.getVirtualItems();
  const virtualTimelineRowKeys = useMemo(
    () => virtualTimelineRows.map((row) => row.key),
    [virtualTimelineRows],
  );

  useEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return undefined;
    }

    const appendScrollDiagnostic = (
      eventKind: "scroll" | "scrollend" | "wheel",
      extra: Record<string, unknown> = {},
    ) => {
      const snapshot = collectTimelineScrollDiagnosticSnapshot(scrollElement);
      const previous = lastTimelineScrollDiagnosticRef.current;
      const now = Date.now();
      const previousSnapshot = previous.snapshot;
      const scrollTopDelta = previousSnapshot
        ? snapshot.scrollTop - previousSnapshot.scrollTop
        : 0;
      const distanceFromBottomDelta = previousSnapshot
        ? snapshot.distanceFromBottom - previousSnapshot.distanceFromBottom
        : 0;
      const isMeaningfulDelta =
        Math.abs(scrollTopDelta) >= TIMELINE_SCROLL_DIAGNOSTIC_MIN_DELTA_PX ||
        Math.abs(distanceFromBottomDelta) >= TIMELINE_SCROLL_DIAGNOSTIC_MIN_DELTA_PX ||
        eventKind === "wheel" ||
        previous.eventKind !== eventKind;
      if (
        !isMeaningfulDelta ||
        now - previous.at < TIMELINE_SCROLL_DIAGNOSTIC_MIN_INTERVAL_MS
      ) {
        return;
      }
      lastTimelineScrollDiagnosticRef.current = { at: now, eventKind, snapshot };
      appendRendererDiagnostic("messages/timeline-scroll-behavior", {
        component: "MessagesTimeline",
        eventKind,
        threadId,
        workspaceId: workspaceId ?? null,
        isThinking,
        isWorking,
        shouldVirtualizeTimeline,
        rowCount: timelineProjectionRows.length,
        renderWeight: timelineRenderWeightSummary.renderWeight,
        virtualItemCount: virtualTimelineRowKeys.length,
        activeLiveRowCount: activeLiveTimelineRowKeys.length,
        scrollTopDelta: Math.round(scrollTopDelta),
        distanceFromBottomDelta: Math.round(distanceFromBottomDelta),
        ...snapshot,
        ...extra,
      });
    };

    const handleScroll = () => appendScrollDiagnostic("scroll");
    const handleScrollEnd = () => appendScrollDiagnostic("scrollend");
    const handleWheel = (event: WheelEvent) => {
      appendScrollDiagnostic("wheel", {
        deltaMode: event.deltaMode,
        deltaX: Math.round(event.deltaX),
        deltaY: Math.round(event.deltaY),
      });
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    scrollElement.addEventListener("wheel", handleWheel, { passive: true });
    scrollElement.addEventListener("scrollend", handleScrollEnd, { passive: true });
    appendScrollDiagnostic("scroll", { reason: "listener-attached" });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      scrollElement.removeEventListener("wheel", handleWheel);
      scrollElement.removeEventListener("scrollend", handleScrollEnd);
    };
  }, [
    activeLiveTimelineRowKeys.length,
    isThinking,
    isWorking,
    scrollElementRef,
    shouldVirtualizeTimeline,
    threadId,
    timelineProjectionRows.length,
    timelineRenderWeightSummary.renderWeight,
    virtualTimelineRowKeys.length,
    workspaceId,
  ]);

  const visibleTimelineRowKeySet = useMemo(
    () => new Set(virtualTimelineRowKeys.map(String)),
    [virtualTimelineRowKeys],
  );
  const virtualizedTimelineScopeKey = useMemo(
    () => [
      presentationScopeKey,
      presentationMode,
      timelineProjectionRows.length,
      timelineRenderWeightSummary.renderWeight,
      shouldVirtualizeTimeline ? "virtualized" : "static",
    ].join("\u0000"),
    [
      presentationMode,
      presentationScopeKey,
      shouldVirtualizeTimeline,
      timelineProjectionRows.length,
      timelineRenderWeightSummary.renderWeight,
    ],
  );
  const timelineRendererOptionsKey = useMemo(
    () => [
      activeEngine,
      presentationProfile?.preferCommandSummary ? "command-summary" : "no-command-summary",
      presentationProfile?.codexCanvasMarkdown ? "codex-canvas" : "plain-markdown",
      codeBlockCopyUseModifier ? "copy-modifier" : "copy-default",
    ].join("|"),
    [
      activeEngine,
      codeBlockCopyUseModifier,
      presentationProfile?.codexCanvasMarkdown,
      presentationProfile?.preferCommandSummary,
    ],
  );
  const retainedHydratedTimelineRowScopeKey = `${virtualizedTimelineScopeKey} ${timelineRendererOptionsKey}`;
  const retainedHydratedTimelineRowKeys = useMemo(() => {
    const retained = retainedHydratedTimelineRowKeysRef.current;
    if (retained.scopeKey !== retainedHydratedTimelineRowScopeKey) {
      retained.scopeKey = retainedHydratedTimelineRowScopeKey;
      retained.rowKeys = new Set();
    }
    return retained.rowKeys;
  }, [retainedHydratedTimelineRowScopeKey]);
  const timelineRowHydrationStates = useMemo(
    () => {
      if (isThinking || isWorking) {
        return timelineProjectionRows.map((row) => ({
          rowKey: row.key,
          contentHash: `${timelineRendererOptionsKey}:${row.key}`,
          rendererOptionsKey: timelineRendererOptionsKey,
          renderWeight: 1,
          heavy: false,
          mode: "static" as const,
          hydrationReason: "not-heavy" as const,
        }));
      }
      const nextStates = deriveTimelineRowHydrationStates({
        rows: timelineProjectionRows,
        shouldVirtualize: shouldDeferHeavyTimelineRows,
        visibleRowKeys: shouldVirtualizeTimeline ? visibleTimelineRowKeySet : new Set<string>(),
        activeRowKeys: activeLiveTimelineRowKeySet,
        retainedHydratedRowKeys: retainedHydratedTimelineRowKeys,
        anchorTargetRowKey: pendingJumpRowKey,
        detailHydrationRequested: conversationDetailHydrationRequested,
        rendererOptionsKey: timelineRendererOptionsKey,
      });
      for (const state of nextStates) {
        if (state.heavy && state.mode === "hydrated") {
          retainedHydratedTimelineRowKeys.add(state.rowKey);
        }
      }
      return nextStates;
    },
    [
      activeLiveTimelineRowKeySet,
      conversationDetailHydrationRequested,
      isThinking,
      isWorking,
      pendingJumpRowKey,
      retainedHydratedTimelineRowKeys,
      shouldDeferHeavyTimelineRows,
      shouldVirtualizeTimeline,
      timelineRendererOptionsKey,
      timelineProjectionRows,
      visibleTimelineRowKeySet,
    ],
  );
  const hydratedHeavyTimelineRowCount = useMemo(
    () => countHydratedHeavyTimelineRows(timelineRowHydrationStates),
    [timelineRowHydrationStates],
  );
  const timelineRowHydrationStateByKey = useMemo(
    () => new Map(timelineRowHydrationStates.map((state) => [state.rowKey, state])),
    [timelineRowHydrationStates],
  );
  const shouldRenderLightweightProjectionRow = useCallback(
    (
      row: TimelineProjectionRow,
      hydrationState: TimelineRowHydrationState | undefined,
    ) => {
      if (row.kind !== "entry" || !hydrationState?.heavy) {
        return false;
      }
      if (
        hydrationState.hydrationReason === "active" ||
        hydrationState.hydrationReason === "anchor"
      ) {
        return false;
      }
      if (isThinking || isWorking) {
        return false;
      }
      if (effectiveConversationLightweightMode && !conversationDetailHydrationRequested) {
        return true;
      }
      if (hydrationState.mode === "hydrated") {
        return false;
      }
      return effectiveConversationLightweightMode || hydrationState.mode === "summary";
    },
    [
      conversationDetailHydrationRequested,
      effectiveConversationLightweightMode,
      isThinking,
      isWorking,
    ],
  );
  const lightweightTimelineRowSignature = useMemo(
    () =>
      timelineProjectionRows
        .filter((row) =>
          shouldRenderLightweightProjectionRow(
            row,
            timelineRowHydrationStateByKey.get(row.key),
          ),
        )
        .map((row) => row.key)
        .join("|"),
    [
      shouldRenderLightweightProjectionRow,
      timelineProjectionRows,
      timelineRowHydrationStateByKey,
    ],
  );
  const hydratedHeavyTimelineRowSignature = useMemo(
    () =>
      timelineRowHydrationStates
        .filter((state) => state.heavy && state.mode === "hydrated")
        .map((state) => `${state.rowKey}:${state.contentHash}:${state.hydrationReason}`)
        .join("|"),
    [timelineRowHydrationStates],
  );
  const liveRowRemeasureSignature = useMemo(() => {
    const assistantTextLength = liveAssistantItem?.text.length ?? 0;
    const reasoningTextLength =
      (liveReasoningItem?.summary.length ?? 0) + (liveReasoningItem?.content.length ?? 0);
    return [
      liveAssistantItem?.id ?? "",
      Math.floor(assistantTextLength / 600),
      liveReasoningItem?.id ?? "",
      Math.floor(reasoningTextLength / 600),
      activeLiveTimelineRowKeys.join(","),
    ].join(":");
  }, [
    activeLiveTimelineRowKeys,
    liveAssistantItem?.id,
    liveAssistantItem?.text.length,
    liveReasoningItem?.content.length,
    liveReasoningItem?.id,
    liveReasoningItem?.summary.length,
  ]);

  // 判定为空的虚拟行：除了 CSS 压成 0，还要主动把虚拟化器内部记录的尺寸归零，
  // 否则 measure() 重算时会沿用上一次的非 0 测量值，导致后续行 translateY 偏移。
  const emptyTimelineRowIndexSignature = useMemo(() => {
    if (!shouldVirtualizeTimeline) {
      return "";
    }
    const indices: number[] = [];
    timelineProjectionRows.forEach((row, index) => {
      const isEmpty = isEmptyVirtualProjectionRow(row, {
        activeEngine,
        claudeHistoryTranscriptFallbackActive,
        hasTailUserInputNode: Boolean(userInputNode),
        isWorking,
        lastDurationMs,
        effectiveItemsCount,
      });
      if (isEmpty) {
        indices.push(index);
      }
    });
    return indices.join(",");
  }, [
    activeEngine,
    claudeHistoryTranscriptFallbackActive,
    effectiveItemsCount,
    isWorking,
    lastDurationMs,
    shouldVirtualizeTimeline,
    timelineProjectionRows,
    userInputNode,
  ]);

  useEffect(() => {
    if (!shouldVirtualizeTimeline || emptyTimelineRowIndexSignature.length === 0) {
      return;
    }
    emptyTimelineRowIndexSignature.split(",").forEach((rawIndex) => {
      const index = Number(rawIndex);
      if (Number.isInteger(index) && index >= 0) {
        timelineVirtualizer.resizeItem(index, 0);
      }
    });
  }, [emptyTimelineRowIndexSignature, shouldVirtualizeTimeline, timelineVirtualizer]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && hydrationRemeasureRafRef.current !== null) {
        window.cancelAnimationFrame(hydrationRemeasureRafRef.current);
        hydrationRemeasureRafRef.current = null;
      }
      if (typeof window !== "undefined" && liveRowRemeasureRafRef.current !== null) {
        window.cancelAnimationFrame(liveRowRemeasureRafRef.current);
        liveRowRemeasureRafRef.current = null;
      }
      if (typeof window !== "undefined" && lightweightRemeasureRafRef.current !== null) {
        window.cancelAnimationFrame(lightweightRemeasureRafRef.current);
        lightweightRemeasureRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (
      !shouldVirtualizeTimeline ||
      lightweightTimelineRowSignature.length === 0 ||
      typeof window === "undefined"
    ) {
      if (typeof window !== "undefined" && lightweightRemeasureRafRef.current !== null) {
        window.cancelAnimationFrame(lightweightRemeasureRafRef.current);
        lightweightRemeasureRafRef.current = null;
      }
      return;
    }
    const recovery = resolveHydrationRemeasureGuard({
      previous: lightweightRemeasureBudgetRef.current,
      signature: lightweightTimelineRowSignature,
      hydratedHeavyRowCount: 1,
      now: Date.now(),
    });
    lightweightRemeasureBudgetRef.current = recovery.nextBudget;
    if (!recovery.shouldRemeasure) {
      return;
    }
    if (lightweightRemeasureRafRef.current !== null) {
      window.cancelAnimationFrame(lightweightRemeasureRafRef.current);
    }
    lightweightRemeasureRafRef.current = window.requestAnimationFrame(() => {
      lightweightRemeasureRafRef.current = null;
      timelineProjectionRows.forEach((row, index) => {
        if (
          shouldRenderLightweightProjectionRow(
            row,
            timelineRowHydrationStateByKey.get(row.key),
          )
        ) {
          timelineVirtualizer.resizeItem(index, TIMELINE_LIGHTWEIGHT_ROW_PLACEHOLDER_HEIGHT);
        }
      });
      remeasureTimelineVirtualizerRows(timelineVirtualizer);
    });
  }, [
    lightweightTimelineRowSignature,
    shouldRenderLightweightProjectionRow,
    shouldVirtualizeTimeline,
    timelineProjectionRows,
    timelineRowHydrationStateByKey,
    timelineVirtualizer,
  ]);

  useEffect(() => {
    if (
      !shouldVirtualizeTimeline ||
      activeLiveTimelineRowKeys.length === 0 ||
      typeof window === "undefined"
    ) {
      return;
    }
    // 流式打字时 liveRowRemeasureSignature 随文本量化变化（每 ~600 字符）→ budget
    // 重置 → 正常重测；只有签名不变还反复触发时才封顶，掐断测量回路闪动。
    const recovery = resolveHydrationRemeasureGuard({
      previous: liveRowRemeasureBudgetRef.current,
      signature: liveRowRemeasureSignature,
      hydratedHeavyRowCount: 1,
      now: Date.now(),
    });
    liveRowRemeasureBudgetRef.current = recovery.nextBudget;
    if (!recovery.shouldRemeasure) {
      return;
    }
    if (liveRowRemeasureRafRef.current !== null) {
      window.cancelAnimationFrame(liveRowRemeasureRafRef.current);
    }
    liveRowRemeasureRafRef.current = window.requestAnimationFrame(() => {
      liveRowRemeasureRafRef.current = null;
      remeasureTimelineVirtualizerRows(timelineVirtualizer);
    });
  }, [
    activeLiveTimelineRowKeys.length,
    liveRowRemeasureSignature,
    shouldVirtualizeTimeline,
    timelineVirtualizer,
  ]);

  useEffect(() => {
    if (!shouldVirtualizeTimeline || hydratedHeavyTimelineRowCount <= 0) {
      hydrationRemeasureBudgetRef.current = DEFAULT_HYDRATION_REMEASURE_BUDGET;
      if (typeof window !== "undefined" && hydrationRemeasureRafRef.current !== null) {
        window.cancelAnimationFrame(hydrationRemeasureRafRef.current);
        hydrationRemeasureRafRef.current = null;
      }
      return;
    }
    const recovery = resolveHydrationRemeasureGuard({
      previous: hydrationRemeasureBudgetRef.current,
      signature: hydratedHeavyTimelineRowSignature,
      hydratedHeavyRowCount: hydratedHeavyTimelineRowCount,
      now: Date.now(),
      diagnosticCooldownMs: TIMELINE_HYDRATION_REMEASURE_DIAGNOSTIC_COOLDOWN_MS,
    });
    hydrationRemeasureBudgetRef.current = recovery.nextBudget;
    if (recovery.shouldRemeasure && typeof window !== "undefined") {
      if (hydrationRemeasureRafRef.current !== null) {
        window.cancelAnimationFrame(hydrationRemeasureRafRef.current);
      }
      hydrationRemeasureRafRef.current = window.requestAnimationFrame(() => {
        hydrationRemeasureRafRef.current = null;
        remeasureTimelineVirtualizerRows(timelineVirtualizer);
      });
    }
    if (!recovery.shouldDiagnose) {
      return;
    }
    appendRendererDiagnostic("messages/timeline-hydration-remeasure", {
      surface: "timeline-virtualizer",
      component: "MessagesTimeline",
      threadId,
      workspaceId: workspaceId ?? null,
      hydratedHeavyRowCount: hydratedHeavyTimelineRowCount,
      remeasureCount: recovery.nextBudget.remeasureCount,
      remeasureSuppressed: recovery.remeasureSuppressed,
      threshold: "bounded-hydration-remeasure",
    });
  }, [
    hydratedHeavyTimelineRowCount,
    hydratedHeavyTimelineRowSignature,
    shouldVirtualizeTimeline,
    threadId,
    timelineVirtualizer,
    workspaceId,
  ]);

  useEffect(() => {
    const thresholdReason = getTimelineVirtualizationThresholdReason({
      rowCount: timelineRenderWeightSummary.rowCount,
      renderWeight: timelineRenderWeightSummary.renderWeight,
    });
    if (!shouldVirtualizeTimeline || thresholdReason !== "render-weight") {
      return;
    }
    const signature = [
      workspaceId ?? "",
      threadId ?? "",
      timelineRenderWeightSummary.rowCount,
      timelineRenderWeightSummary.renderWeight,
      timelineRenderWeightSummary.heavyRowCount,
      hydratedHeavyTimelineRowCount,
    ].join(":");
    const now = Date.now();
    if (
      lastTimelineRenderWeightDiagnosticRef.current.signature === signature &&
      now - lastTimelineRenderWeightDiagnosticRef.current.at <
        TIMELINE_RENDER_WEIGHT_DIAGNOSTIC_COOLDOWN_MS
    ) {
      return;
    }
    lastTimelineRenderWeightDiagnosticRef.current = { at: now, signature };
    appendRendererDiagnostic(
      "messages/timeline-render-weight",
      buildTimelineRenderWeightDiagnosticPayload({
        summary: timelineRenderWeightSummary,
        shouldVirtualize: shouldVirtualizeTimeline,
        hydratedHeavyRowCount: hydratedHeavyTimelineRowCount,
        localErrorState: "none",
        threadId,
        workspaceId: workspaceId ?? null,
      }),
    );
  }, [
    hydratedHeavyTimelineRowCount,
    shouldVirtualizeTimeline,
    threadId,
    timelineRenderWeightSummary,
    workspaceId,
  ]);

  useEffect(() => {
    if (!conversationLightweightPolicy.suggested && !effectiveConversationLightweightMode) {
      return;
    }
    const signature = [
      workspaceId ?? "",
      threadId ?? "",
      conversationLightweightModeState.reason,
      conversationLightweightPolicy.suggested ? "suggested" : "not-suggested",
      conversationLightweightPolicy.oversized ? "oversized" : "not-oversized",
      conversationDetailHydrationRequested ? "detail-requested" : "detail-deferred",
      timelineRenderWeightSummary.rowCount,
      timelineRenderWeightSummary.renderWeight,
      timelineRenderWeightSummary.heavyRowCount,
    ].join(":");
    const now = Date.now();
    if (
      lastConversationLightweightDiagnosticRef.current.signature === signature &&
      now - lastConversationLightweightDiagnosticRef.current.at <
        CONVERSATION_LIGHTWEIGHT_DIAGNOSTIC_COOLDOWN_MS
    ) {
      return;
    }
    lastConversationLightweightDiagnosticRef.current = { at: now, signature };
    appendRendererDiagnostic("messages/conversation-lightweight-mode", {
      surface: "timeline",
      component: "MessagesTimeline",
      workspaceId: workspaceId ?? null,
      threadId,
      active: effectiveConversationLightweightMode,
      reason: conversationLightweightModeState.reason,
      suggested: conversationLightweightPolicy.suggested,
      oversized: conversationLightweightPolicy.oversized,
      detailHydrationRequested: conversationDetailHydrationRequested,
      rowCount: timelineRenderWeightSummary.rowCount,
      renderWeight: timelineRenderWeightSummary.renderWeight,
      heavyRowCount: timelineRenderWeightSummary.heavyRowCount,
    });
  }, [
    conversationDetailHydrationRequested,
    conversationLightweightModeState.reason,
    conversationLightweightPolicy.oversized,
    conversationLightweightPolicy.suggested,
    effectiveConversationLightweightMode,
    threadId,
    timelineRenderWeightSummary.heavyRowCount,
    timelineRenderWeightSummary.renderWeight,
    timelineRenderWeightSummary.rowCount,
    workspaceId,
  ]);

  useEffect(() => {
    if (!pendingJumpMessageId) {
      return;
    }
    if (messageNodeByIdRef.current.get(pendingJumpMessageId)) {
      onPendingJumpTargetReady(pendingJumpMessageId);
      return;
    }
    if (!shouldVirtualizeTimeline || pendingJumpRowIndex < 0) {
      return;
    }
    timelineVirtualizer.scrollToIndex(pendingJumpRowIndex, { align: "center" });
  }, [
    messageNodeByIdRef,
    onPendingJumpTargetReady,
    pendingJumpMessageId,
    pendingJumpRowIndex,
    shouldVirtualizeTimeline,
    timelineVirtualizer,
    virtualTimelineRowKeys,
  ]);

  useEffect(() => {
    const scrollElement = scrollElementRef.current;
    const reset = resolveVirtualizedTimelineScopeReset({
      previousScopeKey: lastVirtualizedTimelineScopeResetRef.current,
      nextScopeKey: virtualizedTimelineScopeKey,
      shouldVirtualize: shouldVirtualizeTimeline,
      stableHistoryView: !isThinking && !isWorking,
      hasPendingJump: Boolean(pendingJumpMessageId),
      hasScrollElement: Boolean(scrollElement),
    });
    lastVirtualizedTimelineScopeResetRef.current = reset.nextScopeKey;
    if (!reset.shouldResetScroll && !reset.shouldMeasure) {
      return undefined;
    }
    // Remeasure only: swapping capped row estimates for real heights is the
    // virtualizer's legitimate job. All scroll pinning — thread-open landing and
    // the "reply ends" re-pin — is now owned by useMessagesScrollOwner, so this
    // effect must never write scrollTop (a second owner would fight the hook).
    if (typeof window === "undefined") {
      remeasureTimelineVirtualizerRows(timelineVirtualizer);
      return undefined;
    }
    const raf = window.requestAnimationFrame(() => {
      remeasureTimelineVirtualizerRows(timelineVirtualizer);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [
    isThinking,
    isWorking,
    pendingJumpMessageId,
    scrollElementRef,
    shouldVirtualizeTimeline,
    timelineVirtualizer,
    virtualizedTimelineScopeKey,
  ]);

  useEffect(() => {
    const scrollElement = scrollElementRef.current;
    const distanceFromBottom = scrollElement
      ? scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
      : Number.POSITIVE_INFINITY;
    const isNearLiveTail =
      Number.isFinite(distanceFromBottom) &&
      distanceFromBottom <= TIMELINE_LIVE_ROW_BOTTOM_PROXIMITY_PX;
    const stabilityState = classifyTimelineVirtualizerStability({
      shouldVirtualize: shouldVirtualizeTimeline,
      rowCount: timelineProjectionRows.length,
      hasScrollElement: Boolean(scrollElement),
      virtualItemKeys: virtualTimelineRowKeys,
      activeLiveRowKeys: activeLiveTimelineRowKeys,
      streamingActive: Boolean((isThinking || isWorking) && isNearLiveTail),
    });
    if (stabilityState === "stable") {
      return;
    }

    const stabilitySignature = [
      stabilityState,
      timelineProjectionRows.length,
      virtualTimelineRowKeys.length,
      activeLiveTimelineRowKeys.length,
      isThinking ? "thinking" : "idle",
      isWorking ? "working" : "idle",
    ].join(":");
    const recovery = resolveTimelineVirtualizerStabilityRecovery({
      previous: timelineStabilityRecoveryBudgetRef.current,
      signature: stabilitySignature,
      now: Date.now(),
      remeasureCooldownMs: TIMELINE_VIRTUALIZER_STABILITY_REMEASURE_COOLDOWN_MS,
      diagnosticCooldownMs: TIMELINE_VIRTUALIZER_STABILITY_DIAGNOSTIC_COOLDOWN_MS,
    });
    timelineStabilityRecoveryBudgetRef.current = recovery.nextBudget;
    if (recovery.shouldRemeasure) {
      remeasureTimelineVirtualizerRows(timelineVirtualizer);
    }
    if (!recovery.shouldDiagnose) {
      return;
    }
    appendRendererDiagnostic("messages/timeline-virtualizer-stability", {
      state: stabilityState,
      threadId,
      workspaceId: workspaceId ?? null,
      rowCount: timelineProjectionRows.length,
      virtualItemCount: virtualTimelineRowKeys.length,
      activeLiveRowCount: activeLiveTimelineRowKeys.length,
      hydratedHeavyRowCount: hydratedHeavyTimelineRowCount,
      isThinking,
      isWorking,
      isNearLiveTail,
      recoveryRemeasureCount: recovery.nextBudget.remeasureCount,
      recoveryRemeasureSuppressed: recovery.remeasureSuppressed,
      distanceFromBottom: Number.isFinite(distanceFromBottom)
        ? Math.max(0, Math.round(distanceFromBottom))
        : null,
    });
  }, [
    activeLiveTimelineRowKeys,
    isThinking,
    isWorking,
    scrollElementRef,
    shouldVirtualizeTimeline,
    threadId,
    hydratedHeavyTimelineRowCount,
    timelineProjectionRows.length,
    timelineVirtualizer,
    virtualTimelineRowKeys,
    workspaceId,
  ]);

  // MessageRow 的 memo 比较器按引用比对 userActionNode；若每次时间线渲染都新建
  // 元素，所有用户行都会被打穿并真实重渲染（流式期间每个 token 一次）。按行缓存
  // 元素，仅在影响输出的输入（item 引用 / 复制文案 / 已复制态 / 语言）变化时重建。
  const userActionNodeCacheRef = useRef(
    new Map<
      string,
      {
        item: ConversationItem;
        copyText: string;
        isCopied: boolean;
        translate: typeof t;
        node: ReactNode;
      }
    >(),
  );
  const USER_ACTION_NODE_CACHE_LIMIT = 500;

  const renderSingleItem = (item: ConversationItem) => {
    const renderItem = resolveLiveRenderItem(
      item,
      liveAssistantItem,
      liveReasoningItem,
      // 与 messagesViewModel 的 appendReasoningRuns 同谓词:仅追加式引擎会产生合并块
      activeEngine === "claude" || activeEngine === "gemini",
    );
    const renderKind = resolveNormalizedRenderKind(renderItem);
    if (renderKind === "message" && renderItem.kind === "message") {
      const itemRenderKey = `message:${renderItem.id}`;
      const isCopied = copiedMessageId === renderItem.id;
      const agentTaskNotification = parseAgentTaskNotification(renderItem.text);
      const shouldRenderFinalBoundary =
        renderItem.role === "assistant" &&
        renderItem.isFinal === true &&
        assistantFinalBoundarySet.has(renderItem.id) &&
        !assistantLiveTurnFinalBoundarySuppressedSet.has(renderItem.id);
      const finalMetaParts: string[] = [];
      if (typeof renderItem.finalCompletedAt === "number" && renderItem.finalCompletedAt > 0) {
        finalMetaParts.push(formatCompletedTimeMs(renderItem.finalCompletedAt));
      }
      const finalMetaText = finalMetaParts.join(" · ");
      const actionTargetUserMessageId =
        renderItem.role === "assistant"
          ? messageActionTargetByAssistantId.get(renderItem.id) ?? null
          : null;
      const isLatestFinalAssistant =
        renderItem.id === latestFinalAssistantMessageId;
      const shouldRenderAssistantActions =
        renderItem.role === "assistant" && renderItem.isFinal === true;
      const assistantCopyText =
        renderItem.role === "assistant"
          ? messageCopyTextByAssistantId.get(renderItem.id) ?? renderItem.text
          : renderItem.text;
      const userCopyText =
        renderItem.role === "user"
          ? resolveUserMessagePresentation({
              text: renderItem.text,
              selectedAgentName: renderItem.selectedAgentName,
              selectedAgentIcon: renderItem.selectedAgentIcon,
              enableCollaborationBadge: activeEngine === "codex",
            }).displayText
          : "";
      const shouldRenderUserActions =
        renderItem.role === "user" && userCopyText.trim().length > 0;
      const shouldRenderForkAction =
        isLatestFinalAssistant &&
        Boolean(actionTargetUserMessageId) &&
        typeof onForkFromMessage === "function";
      const shouldRenderRewindAction =
        isLatestFinalAssistant &&
        Boolean(actionTargetUserMessageId) &&
        typeof onRewindFromMessage === "function";
      const renderAssistantActions = () => {
        if (!shouldRenderAssistantActions) {
          return null;
        }
        return (
          <div
            className="message-action-bar message-action-bar-row"
            aria-label={t("messages.messageActions")}
          >
            <button
              type="button"
              className={`ghost message-action-button message-copy-button${isCopied ? " is-copied" : ""}`}
              onClick={() => handleCopyMessage(renderItem, assistantCopyText)}
              aria-label={t("messages.copyMessage")}
              title={t("messages.copyMessage")}
            >
              <span className="message-copy-icon" aria-hidden>
                <Copy className="message-copy-icon-copy" size={12} />
                <Check className="message-copy-icon-check" size={12} />
              </span>
            </button>
            {shouldRenderForkAction && actionTargetUserMessageId ? (
              <button
                type="button"
                className="ghost message-action-button"
                onClick={() => onForkFromMessage(actionTargetUserMessageId)}
                aria-label={t("messages.forkMessage")}
                title={t("messages.forkMessage")}
              >
                <span className="codicon codicon-git-branch-create" aria-hidden />
              </button>
            ) : null}
            {shouldRenderRewindAction && actionTargetUserMessageId ? (
              <button
                type="button"
                className="ghost message-action-button"
                onClick={() => onRewindFromMessage(actionTargetUserMessageId)}
                aria-label={t("messages.rewindMessage")}
                title={t("messages.rewindMessage")}
              >
                <span className="codicon codicon-history" aria-hidden />
              </button>
            ) : null}
          </div>
        );
      };
      const renderUserActions = () => {
        if (!shouldRenderUserActions) {
          return null;
        }
        const cache = userActionNodeCacheRef.current;
        const cached = cache.get(renderItem.id);
        if (
          cached &&
          cached.item === renderItem &&
          cached.copyText === userCopyText &&
          cached.isCopied === isCopied &&
          cached.translate === t
        ) {
          return cached.node;
        }
        const node = (
          <div
            className="message-action-bar message-user-bubble-actions"
            aria-label={t("messages.messageActions")}
          >
            <button
              type="button"
              className={`ghost message-action-button message-copy-button${isCopied ? " is-copied" : ""}`}
              onClick={() => handleCopyMessage(renderItem, userCopyText)}
              aria-label={t("messages.copyUserMessage")}
              title={t("messages.copyUserMessage")}
            >
              <span className="message-copy-icon" aria-hidden>
                <Copy className="message-copy-icon-copy" size={12} />
                <Check className="message-copy-icon-check" size={12} />
              </span>
            </button>
          </div>
        );
        if (cache.size >= USER_ACTION_NODE_CACHE_LIMIT) {
          cache.clear();
        }
        cache.set(renderItem.id, {
          item: renderItem,
          copyText: userCopyText,
          isCopied,
          translate: t,
          node,
        });
        return node;
      };
      const bindMessageNode = (node: HTMLDivElement | null) => {
        if (renderItem.role === "user" && node) {
          messageNodeByIdRef.current.set(renderItem.id, node);
        } else {
          messageNodeByIdRef.current.delete(renderItem.id);
        }
        if (agentTaskNotification?.taskId && node) {
          agentTaskNodeByTaskIdRef.current.set(agentTaskNotification.taskId, node);
        } else if (agentTaskNotification?.taskId) {
          agentTaskNodeByTaskIdRef.current.delete(agentTaskNotification.taskId);
        }
        if (agentTaskNotification?.toolUseId && node) {
          agentTaskNodeByToolUseIdRef.current.set(agentTaskNotification.toolUseId, node);
        } else if (agentTaskNotification?.toolUseId) {
          agentTaskNodeByToolUseIdRef.current.delete(agentTaskNotification.toolUseId);
        }
      };
      return (
        <Fragment key={itemRenderKey}>
          <div
            ref={bindMessageNode}
            data-message-anchor-id={renderItem.id}
            data-agent-task-id={agentTaskNotification?.taskId ?? undefined}
            data-agent-tool-use-id={agentTaskNotification?.toolUseId ?? undefined}
          >
            <MessageRow
              item={renderItem}
              workspaceId={workspaceId}
              threadId={threadId}
              isStreaming={
                (activeEngine === "claude" ||
                  activeEngine === "codex" ||
                  activeEngine === "gemini") &&
                renderItem.role === "assistant" &&
                renderItem.recoveredFromLiveShadow !== true &&
                renderItem.id === liveAssistantMessageId
              }
              activeEngine={activeEngine}
              activeCollaborationModeId={activeCollaborationModeId}
              enableCollaborationBadge={activeEngine === "codex"}
              presentationProfile={presentationProfile}
              showRuntimeReconnectCard={renderItem.id === latestRuntimeReconnectItemId}
              onRecoverThreadRuntime={onRecoverThreadRuntime}
              onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
              onThreadRecoveryFork={onThreadRecoveryFork}
              retryMessage={
                renderItem.id === latestRuntimeReconnectItemId
                  ? latestRetryMessage
                  : null
              }
              userActionNode={renderUserActions()}
              codeBlockCopyUseModifier={codeBlockCopyUseModifier}
              onOpenFileLink={openFileLink}
              onOpenFileLinkMenu={showFileLinkMenu}
              streamMitigationProfile={streamMitigationProfile}
              onAssistantVisibleTextRender={onAssistantVisibleTextRender}
              suppressMemorySummaryCard={suppressedUserMemoryContextMessageIds.has(renderItem.id)}
              suppressNoteCardSummaryCard={suppressedUserNoteCardContextMessageIds.has(renderItem.id)}
              onOutlineReady={
                renderItem.role === "assistant" && renderItem.id === liveAssistantMessageId
                  ? liveAssistantOutlineReady
                  : undefined
              }
            />
          </div>
          {shouldRenderFinalBoundary && (
            <Marker
              variant="separator"
              role="separator"
              className="messages-turn-boundary messages-final-boundary"
            >
              <span className="messages-turn-boundary-label">
                <span className="messages-turn-boundary-label-content">
                  {t("messages.finalMessageBoundary")}
                </span>
              </span>
              {finalMetaText && (
                <span className="messages-turn-boundary-meta">{finalMetaText}</span>
              )}
              {renderAssistantActions()}
            </Marker>
          )}
        </Fragment>
      );
    }
    if (renderKind === "reasoning" && renderItem.kind === "reasoning") {
      const itemRenderKey = `reasoning:${renderItem.id}`;
      const isExpanded = expandedItems.has(renderItem.id);
      const parsed = reasoningMetaById.get(renderItem.id) ?? parseReasoning(renderItem);
      const isLiveReasoning =
        isThinking && latestReasoningId === renderItem.id;
      return (
        <ReasoningRow
          key={itemRenderKey}
          item={renderItem}
          workspaceId={workspaceId}
          parsed={parsed}
          isExpanded={isExpanded}
          isLive={isLiveReasoning}
          activeEngine={activeEngine}
          onToggle={toggleExpanded}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          presentationProfile={presentationProfile}
          streamMitigationProfile={streamMitigationProfile}
        />
      );
    }
    if (renderKind === "review" && renderItem.kind === "review") {
      return (
        <ReviewRow
          key={`review:${renderItem.id}`}
          item={renderItem}
          workspaceId={workspaceId}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
        />
      );
    }
    if (renderKind === "generatedImage" && renderItem.kind === "generatedImage") {
      return (
        <GeneratedImageRow
          key={`generated-image:${renderItem.id}`}
          item={renderItem}
          workspaceId={workspaceId}
        />
      );
    }
    if (renderKind === "diff" && renderItem.kind === "diff") {
      return <DiffRow key={`diff:${renderItem.id}`} item={renderItem} />;
    }
    if (renderKind === "tool" && renderItem.kind === "tool") {
      if (shouldHideCodexCanvasCommandCard(renderItem, activeEngine)) {
        return null;
      }
      const isExpanded = expandedItems.has(renderItem.id);
      const selectedExitPlanExecutionMode =
        selectedExitPlanExecutionByItemKey[`${threadId ?? "no-thread"}:${renderItem.id}`] ?? null;
      const provenanceLabel = resolveProvenanceEngineLabel(renderItem.engineSource);
      return (
        <div key={`tool:${renderItem.id}`} className="message-tool-block-shell">
          {provenanceLabel ? (
            <div className="message-provenance-row">
              <span className="message-provenance-badge">{provenanceLabel}</span>
            </div>
          ) : null}
          <ToolBlockRenderer
            item={renderItem}
            workspaceId={workspaceId}
            isExpanded={isExpanded}
            onToggle={toggleExpanded}
            onRequestAutoScroll={requestAutoScroll}
            activeCollaborationModeId={activeCollaborationModeId}
            activeEngine={activeEngine}
            hasPendingUserInputRequest={activeUserInputRequestId !== null}
            onOpenDiffPath={onOpenDiffPath}
            selectedExitPlanExecutionMode={selectedExitPlanExecutionMode}
            onExitPlanModeExecute={handleExitPlanModeExecuteForItem}
          />
        </div>
      );
    }
    if (renderKind === "explore" && renderItem.kind === "explore") {
      const isExpanded =
        liveAutoExpandedExploreId === renderItem.id || expandedItems.has(renderItem.id);
      return (
        <ExploreRow
          key={`explore:${renderItem.id}`}
          item={renderItem}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
        />
      );
    }
    return null;
  };

  const renderEntry = (entry: GroupedEntry) => {
    const shouldRenderUserInputAfterEntry = Boolean(
      userInputNode &&
        activeUserInputAnchorItemId &&
        groupedEntryContainsItemId(entry, activeUserInputAnchorItemId),
    );
    const renderWithAnchoredUserInput = (node: ReactNode) => {
      if (!shouldRenderUserInputAfterEntry) {
        return node;
      }
      return (
        <Fragment key={`user-input-anchor:${activeUserInputAnchorItemId}`}>
          {node}
          {userInputNode}
        </Fragment>
      );
    };
    if (entry.kind === "readGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <ReadToolGroupBlock key={`rg-${firstItem?.id ?? "read-group"}`} items={entry.items} />,
      );
    }
    if (entry.kind === "editGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <EditToolGroupBlock
          key={`eg-${firstItem?.id ?? "edit-group"}`}
          items={entry.items}
          onOpenDiffPath={onOpenDiffPath}
        />,
      );
    }
    if (entry.kind === "bashGroup") {
      if (
        activeEngine === "codex" ||
        (activeEngine === "claude" && !claudeHistoryTranscriptFallbackActive)
      ) {
        return null;
      }
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <BashToolGroupBlock
          key={`bg-${firstItem?.id ?? "bash-group"}`}
          items={entry.items}
          onRequestAutoScroll={requestAutoScroll}
        />,
      );
    }
    if (entry.kind === "searchGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <SearchToolGroupBlock key={`sg-${firstItem?.id ?? "search-group"}`} items={entry.items} />,
      );
    }
    return renderWithAnchoredUserInput(renderSingleItem(entry.item));
  };
  const getLightweightRowKindLabel = (row: TimelineProjectionRow) => {
    if (row.kind !== "entry") {
      return row.kind;
    }
    if (row.entry.kind !== "item") {
      return row.entry.kind;
    }
    const item = row.entry.item;
    if (item.kind === "message") {
      return item.role === "assistant"
        ? t("messages.conversationLightweightAssistantMessage")
        : t("messages.conversationLightweightUserMessage");
    }
    return item.kind;
  };
  const renderLightweightProjectionRow = (
    row: TimelineProjectionRow,
    hydrationState: TimelineRowHydrationState,
  ) => {
    const rowKindLabel = getLightweightRowKindLabel(row);
    const itemCount = row.kind === "entry" ? row.itemIds.length : 1;
    const singleMessage =
      row.kind === "entry" && row.entry.kind === "item" && row.entry.item.kind === "message"
        ? row.entry.item
        : null;
    const actionTargetUserMessageId =
      singleMessage?.role === "assistant"
        ? messageActionTargetByAssistantId.get(singleMessage.id) ?? null
        : null;
    const shouldRenderForkAction =
      singleMessage?.id === latestFinalAssistantMessageId &&
      Boolean(actionTargetUserMessageId) &&
      typeof onForkFromMessage === "function";
    const shouldRenderRewindAction =
      singleMessage?.id === latestFinalAssistantMessageId &&
      Boolean(actionTargetUserMessageId) &&
      typeof onRewindFromMessage === "function";
    const bindLightweightMessageNode = (node: HTMLDivElement | null) => {
      if (!singleMessage || singleMessage.role !== "user") {
        return;
      }
      if (node) {
        messageNodeByIdRef.current.set(singleMessage.id, node);
      } else {
        messageNodeByIdRef.current.delete(singleMessage.id);
      }
    };

    return (
      <div
        ref={bindLightweightMessageNode}
        className="messages-lightweight-row-summary"
        data-conversation-lightweight-row="true"
        data-message-anchor-id={singleMessage?.id}
      >
        <div className="messages-lightweight-row-summary-main">
          <span className="messages-lightweight-row-summary-eyebrow">
            {t("messages.conversationLightweightRowEyebrow")}
          </span>
          <strong>
            {t("messages.conversationLightweightRowTitle", {
              kind: rowKindLabel,
              count: itemCount,
            })}
          </strong>
          <span>
            {t("messages.conversationLightweightRowMeta", {
              weight: hydrationState.renderWeight,
            })}
          </span>
        </div>
        <div className="messages-lightweight-row-summary-actions">
          {shouldRenderForkAction && actionTargetUserMessageId ? (
            <button
              type="button"
              className="ghost message-action-button"
              onClick={() => onForkFromMessage(actionTargetUserMessageId)}
              aria-label={t("messages.forkMessage")}
              title={t("messages.forkMessage")}
            >
              <span className="codicon codicon-git-branch-create" aria-hidden />
            </button>
          ) : null}
          {shouldRenderRewindAction && actionTargetUserMessageId ? (
            <button
              type="button"
              className="ghost message-action-button"
              onClick={() => onRewindFromMessage(actionTargetUserMessageId)}
              aria-label={t("messages.rewindMessage")}
              title={t("messages.rewindMessage")}
            >
              <span className="codicon codicon-history" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="messages-lightweight-row-detail-button"
            onClick={onConversationDetailHydrationRequest}
          >
            {t("messages.conversationLightweightHydrateVisible")}
          </button>
        </div>
      </div>
    );
  };
  const renderProjectionRow = (row: ReturnType<typeof timelineRowByKey.get>) => {
    if (!row) {
      return null;
    }
    if (row.kind === "entry") {
      return renderEntry(row.entry);
    }
    if (row.kind === "dockedReasoning") {
      const dockedReasoning = dockedReasoningById.get(row.itemId);
      if (!dockedReasoning) {
        return null;
      }
      const { item, parsed } = dockedReasoning;
      return (
        <ReasoningRow
          key={`claude-live-${item.id}`}
          item={item}
          workspaceId={workspaceId}
          parsed={parsed}
          isExpanded={isThinking && latestReasoningId === item.id ? true : expandedItems.has(item.id)}
          isLive={isThinking && latestReasoningId === item.id}
          onToggle={toggleExpanded}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          presentationProfile={presentationProfile}
          streamMitigationProfile={streamMitigationProfile}
        />
      );
    }
    if (row.kind === "tailUserInput") {
      return userInputNode;
    }
    if (row.kind === "liveMiddleCollapsed") {
      return (
        <div className="messages-live-middle-collapsed-indicator" role="status">
          {t("messages.middleStepsCollapsedHint", { count: row.count })}
        </div>
      );
    }
    if (row.kind === "workingIndicator") {
      return (
        <WorkingIndicator
          isThinking={isWorking}
          proxyEnabled={proxyEnabled}
          proxyUrl={proxyUrl}
          processingStartedAt={processingStartedAt}
          lastDurationMs={lastDurationMs}
          heartbeatPulse={heartbeatPulse}
          hasItems={effectiveItemsCount > 0}
          reasoningLabel={latestReasoningLabel}
          activityLabel={latestWorkingActivityLabel}
          primaryLabel={primaryWorkingLabel}
          activeEngine={activeEngine}
          waitingForFirstChunk={waitingForFirstChunk}
          presentationProfile={presentationProfile}
          streamActivityPhase={streamActivityPhase}
        />
      );
    }
    if (row.kind === "emptyState") {
      if (row.state === "historyLoading") {
        return (
          <div
            className="empty messages-empty messages-history-loading"
            role="status"
            aria-live="polite"
          >
            <span className="working-spinner" aria-hidden="true" />
            <div className="messages-history-loading-copy">
              <strong>{t("messages.restoringHistory")}</strong>
              <span>{t("messages.restoringHistoryHint")}</span>
            </div>
          </div>
        );
      }
      if (row.state === "hiddenReasoning") {
        return (
          <div className="empty messages-empty messages-hidden-reasoning">
            {t("messages.hiddenThinkingContent")}
          </div>
        );
      }
      return <div className="empty messages-empty">{t("messages.emptyThread")}</div>;
    }
    if (row.kind === "approval") {
      return approvalNode;
    }
    if (row.kind === "bottomAnchor") {
      return null;
    }
    return null;
  };
  const renderProjectionRowWithBoundary = (
    row: ReturnType<typeof timelineRowByKey.get>,
  ) => {
    if (!row) {
      return null;
    }
    const hydrationState = timelineRowHydrationStateByKey.get(row.key);
    return (
      <ConversationRowErrorBoundary
        key={`row-boundary:${row.key}:${hydrationState?.contentHash ?? "unknown"}`}
        rowKey={row.key}
        rowKind={row.kind}
        contentHash={hydrationState?.contentHash ?? null}
        renderWeight={hydrationState?.renderWeight ?? null}
        engine={activeEngine}
        threadId={threadId}
        workspaceId={workspaceId ?? null}
        fallbackTitle={t("messages.rowRenderFailedTitle")}
        fallbackDescription={t("messages.rowRenderFailedDescription")}
        retryLabel={t("messages.rowRenderRetry")}
        retryBlockedLabel={t("messages.rowRenderRetryBlocked")}
      >
        {shouldRenderLightweightProjectionRow(row, hydrationState) && hydrationState
          ? renderLightweightProjectionRow(row, hydrationState)
          : renderProjectionRow(row)}
      </ConversationRowErrorBoundary>
    );
  };
  const renderVirtualProjectionRows = () => (
    <div
      className="messages-virtualized-canvas"
      style={{
        height: `${timelineVirtualizer.getTotalSize()}px`,
        position: "relative",
      }}
    >
      {virtualTimelineRows.map((virtualRow) => {
        const row = timelineProjectionRows[virtualRow.index];
        const isActiveLiveTimelineRow = activeLiveTimelineRowKeySet.has(String(virtualRow.key));
        const hydrationState = row ? timelineRowHydrationStateByKey.get(row.key) : undefined;
        const isLightweightTimelineRow = row
          ? shouldRenderLightweightProjectionRow(row, hydrationState)
          : false;
        const estimatedRowSize = estimateTimelineProjectionRowSize(row ?? {
          kind: "bottomAnchor",
          key: "bottom-anchor",
        });
        const isEmptyTimelineRow = row
          ? isEmptyVirtualProjectionRow(row, {
              activeEngine,
              claudeHistoryTranscriptFallbackActive,
              hasTailUserInputNode: Boolean(userInputNode),
              isWorking,
              lastDurationMs,
              effectiveItemsCount,
            })
          : false;
        // 渲染为空/null 的行不应占据估高占位，否则虚拟行的 minHeight 会撑出大段空白。
        const placeholderHeight = isEmptyTimelineRow
          ? 0
          : resolveVirtualizedTimelineRowVisualHeight({
              measuredSize: virtualRow.size,
              estimatedSize: estimatedRowSize,
              lightweight: isLightweightTimelineRow,
            });
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            data-active-live-row={isActiveLiveTimelineRow ? "true" : undefined}
            data-conversation-lightweight-virtual-row={isLightweightTimelineRow ? "true" : undefined}
            data-timeline-row-kind={row?.kind}
            data-empty-virtual-row={isEmptyTimelineRow ? "true" : undefined}
            data-virtual-row-size={placeholderHeight}
            className={
              isEmptyTimelineRow
                ? "messages-virtualized-row is-empty-virtual-row"
                : isActiveLiveTimelineRow
                  ? "messages-virtualized-row is-active-live-row"
                  : "messages-virtualized-row"
            }
            // 空行不挂 measureElement：避免内层残留内容/margin 穿透被测成非 0
            // 高度，扰乱后续行的 translateY 累加（重叠 + 测量回路闪动的根因）。
            ref={isEmptyTimelineRow ? undefined : timelineVirtualizer.measureElement}
            style={{
              left: 0,
              height: isEmptyTimelineRow ? 0 : undefined,
              // 只有轻量摘要行（固定高度卡片）用估高占位；普通行的高度交给
              // measureElement 量真实内容。给普通行设 minHeight=估高会与
              // measureElement 形成正反馈棘轮：元素被撑到估高 → 量得估高 →
              // 永远塌不回真实内容高度，短内容行下方因此残留大段空白。
              minHeight: isLightweightTimelineRow ? `${placeholderHeight}px` : undefined,
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              width: "100%",
            }}
          >
            {isEmptyTimelineRow ? null : renderProjectionRowWithBoundary(row)}
          </div>
        );
      })}
    </div>
  );
  const renderStaticProjectionRows = () =>
    timelineProjectionRows.map((row) => (
      <Fragment key={row.key}>{renderProjectionRowWithBoundary(row)}</Fragment>
    ));

  const handleJumpToHeading = (headingId: string) => {
    const target = document.getElementById(headingId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const shouldShowConversationLightweightPrompt =
    !isThinking &&
    !isWorking &&
    !conversationDetailHydrationRequested &&
    (conversationLightweightPolicy.suggested || effectiveConversationLightweightMode);
  const renderConversationLightweightPrompt = () => {
    if (!shouldShowConversationLightweightPrompt) {
      return null;
    }
    const titleKey = conversationLightweightPolicy.oversized
      ? "messages.conversationOversizedHistoryTitle"
      : effectiveConversationLightweightMode
        ? "messages.conversationLightweightModeTitle"
        : "messages.conversationLightweightSuggestionTitle";
    const descriptionKey = conversationLightweightPolicy.oversized
      ? "messages.conversationOversizedHistoryDescription"
      : effectiveConversationLightweightMode
        ? "messages.conversationLightweightModeDescription"
        : "messages.conversationLightweightSuggestionDescription";
    return (
      <div
        className="messages-lightweight-mode-banner"
        data-conversation-lightweight-mode={effectiveConversationLightweightMode ? "active" : "suggested"}
        role="status"
      >
        <div className="messages-lightweight-mode-banner-copy">
          <span className="messages-lightweight-mode-banner-eyebrow">
            {t("messages.conversationLightweightModeEyebrow")}
          </span>
          <strong>{t(titleKey)}</strong>
          <span>
            {t(descriptionKey, {
              heavyRows: timelineRenderWeightSummary.heavyRowCount,
              renderWeight: timelineRenderWeightSummary.renderWeight,
              rows: timelineRenderWeightSummary.rowCount,
            })}
          </span>
        </div>
        <div className="messages-lightweight-mode-banner-actions">
          {!effectiveConversationLightweightMode ? (
            <button type="button" onClick={onConversationLightweightModeEnable}>
              {t("messages.conversationLightweightUse")}
            </button>
          ) : null}
          <button type="button" onClick={onConversationDetailHydrationRequest}>
            {t("messages.conversationLightweightHydrateVisible")}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={floaterContainerRef}
      className="messages-timeline-root"
      data-timeline-static-expanded-history={
        shouldUseStaticExpandedHistoryFlow ? "true" : undefined
      }
      data-timeline-static-lightweight-history={
        shouldUseStaticLightweightHistoryFlow ? "true" : undefined
      }
      data-timeline-presentation-mode={presentationMode}
      data-timeline-presentation-scope={presentationScopeKey}
    >
      <MessagesOutlineFloater
        outline={SHOW_OUTLINE_FLOATER ? (currentOutline?.outline ?? null) : null}
        activeHeadingId={activeHeadingId}
        onJumpToHeading={handleJumpToHeading}
      />
      <div
        className="messages-full"
        data-timeline-projection-row-count={timelineProjectionRows.length}
        data-timeline-virtualized={shouldVirtualizeTimeline ? "true" : "false"}
      >
        {renderConversationLightweightPrompt()}
        {visibleCollapsedHistoryItemCount > 0 && (
          <div
            className="messages-collapsed-indicator"
            data-collapsed-count={visibleCollapsedHistoryItemCount}
            onClick={onShowAllHistoryItems}
          >
            {t("messages.showEarlierMessages", { count: visibleCollapsedHistoryItemCount })}
          </div>
        )}
        {shouldVirtualizeTimeline ? renderVirtualProjectionRows() : renderStaticProjectionRows()}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
