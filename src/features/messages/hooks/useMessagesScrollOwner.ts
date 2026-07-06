import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { SCROLL_THRESHOLD_PX } from "../components/messagesRenderUtils";
import {
  isMessagesScrollNearBottom,
  readHistoryExpansionScrollSnapshot,
  restoreHistoryExpansionScrollPosition,
  type HistoryExpansionScrollSnapshot,
} from "../components/messagesViewModel";

export type ScrollOwnerAction = "pin" | "pin-with-rafs" | "restore" | "none";

/**
 * Pure decision core for the scroll owner's transition-window handling. Kept
 * side-effect-free so the truth table is unit-testable without a DOM.
 *
 * - Outside the owned transition window we never touch scroll → "none".
 * - While the user is stuck to the bottom we hard-pin; on the settle commit we
 *   also want the 2-rAF re-pin chain to absorb the virtualizer remeasure.
 * - When the user has scrolled away we restore their spot via the recorded
 *   height delta (only if we have a geometry baseline to compensate against).
 */
export function resolveScrollOwnerAction(input: {
  inTransitionWindow: boolean;
  stuck: boolean;
  justSettled: boolean;
  hasGeometry: boolean;
}): ScrollOwnerAction {
  if (!input.inTransitionWindow) {
    return "none";
  }
  if (input.stuck) {
    return input.justSettled ? "pin-with-rafs" : "pin";
  }
  return input.hasGeometry ? "restore" : "none";
}

export type MessagesScrollOwner = {
  /** Call from onScroll BEFORE scheduleAnchorUpdate. */
  notifyUserScroll: () => void;
  /** Replaces requestAutoScroll (same guard semantics). */
  requestFollow: () => void;
  /** For anchor-jump / "user navigated away" writers. */
  setStick: (stick: boolean) => void;
};

/**
 * Single owner of the messages viewport's vertical scroll position. Replaces the
 * scattered autoScrollRef / auto-follow / initial-pin / MessagesTimeline pins.
 *
 * The load-bearing case is the streaming→settle transition: when a reply ends,
 * buildLiveTailWorkingSet stops trimming and the full transcript re-mounts above
 * the viewport (on the isThinking→false commit), while heavy rows swap to
 * collapsed placeholders and shrink scrollHeight. Without compensation WebKit
 * clamps scrollTop upward and the viewport jumps to the top. We own an explicit
 * transition window spanning that commit through the ~320ms finalize settle
 * (plus a 2-rAF re-pin tail) and either hard-pin the bottom (stuck) or restore
 * the user's spot via the recorded height delta (scrolled away).
 */
export function useMessagesScrollOwner(params: {
  containerRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  scopeKey: string;
  isThinking: boolean;
  isWorking: boolean;
  isAssistantFinalizing: boolean;
  liveAutoFollowEnabled: boolean;
  isHistoryLoading: boolean;
  hasPendingJump: boolean;
  renderedItemCount: number;
  omittedBeforeWorkingSetCount: number;
  timelinePresentationItems: unknown[];
}): MessagesScrollOwner {
  const {
    containerRef,
    bottomRef,
    scopeKey,
    isThinking,
    isWorking,
    isAssistantFinalizing,
    liveAutoFollowEnabled,
    isHistoryLoading,
    hasPendingJump,
    renderedItemCount,
    omittedBeforeWorkingSetCount,
    timelinePresentationItems,
  } = params;

  // Single source of truth for "should the viewport track the bottom". No state
  // → these writes never trigger a re-render.
  const stickToBottomRef = useRef(true);
  const prevSettledRef = useRef(!isThinking && !isAssistantFinalizing);
  const prevIsThinkingRef = useRef(isThinking);
  const prevScopeKeyRef = useRef(scopeKey);
  const prevOmittedRef = useRef(omittedBeforeWorkingSetCount);
  const lastGeometryRef = useRef<HistoryExpansionScrollSnapshot | null>(null);
  const initialPinScopeRef = useRef<string | null>(null);
  const transitionWindowActiveRef = useRef(false);
  const pinRafRef = useRef<number | null>(null);

  // Mirror the reactive inputs the stable callbacks read at call time so they can
  // stay identity-stable (matches the existing latestItemsRef pattern in Messages).
  const isWorkingRef = useRef(isWorking);
  isWorkingRef.current = isWorking;
  const liveAutoFollowEnabledRef = useRef(liveAutoFollowEnabled);
  liveAutoFollowEnabledRef.current = liveAutoFollowEnabled;

  // Core transition-window layout effect. Runs pre-paint on every DOM-relevant
  // commit so pins/restores land before the browser can show the jump.
  useLayoutEffect(() => {
    const container = containerRef.current;

    // Hard pin for the finalize transition: force the absolute bottom past any
    // sticky slot (spec-mandated container.scrollTop = scrollHeight).
    const hardPinToBottom = () => {
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    };
    // Sentinel pin for thread-open + streaming follow: matches the former
    // scrollIntoView behavior so those observable paths are unchanged.
    const pinToBottomSentinel = () => {
      bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
    };
    const cancelPinRafs = () => {
      if (pinRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(pinRafRef.current);
      }
      pinRafRef.current = null;
    };
    const scheduleRepinChain = (pin: () => void) => {
      cancelPinRafs();
      if (typeof window === "undefined" || !container) {
        return;
      }
      // Two frames past settle: the virtualizer's post-commit remeasure grows
      // total height as capped estimates resolve; re-pin so the bottom stays put.
      pinRafRef.current = window.requestAnimationFrame(() => {
        if (stickToBottomRef.current) {
          pin();
        }
        pinRafRef.current = window.requestAnimationFrame(() => {
          if (stickToBottomRef.current) {
            pin();
          }
          pinRafRef.current = null;
        });
      });
    };

    // 1. Scope reset first: a thread/workspace switch re-arms stick and drops all
    //    geometry/window state so a stale snapshot can never restore into a
    //    different thread.
    const scopeChanged = prevScopeKeyRef.current !== scopeKey;
    if (scopeChanged) {
      prevScopeKeyRef.current = scopeKey;
      stickToBottomRef.current = true;
      lastGeometryRef.current = null;
      transitionWindowActiveRef.current = false;
      prevOmittedRef.current = omittedBeforeWorkingSetCount;
      cancelPinRafs();
    }

    // 2. Settle detection.
    const nowSettled = !isThinking && !isAssistantFinalizing;
    const justSettled = nowSettled && !prevSettledRef.current;
    const justStoppedThinking = prevIsThinkingRef.current && !isThinking;
    // buildLiveTailWorkingSet drops history while thinking; when it re-appears
    // (omitted count collapses to 0) the full transcript re-mounts above the
    // viewport. This is the same commit as isThinking→false, but detecting the
    // remount too keeps us robust to whichever commit the DOM actually grows on.
    const remounted = prevOmittedRef.current > 0 && omittedBeforeWorkingSetCount === 0;

    // 3. Owned transition window: opens on isThinking→false (or the remount) and
    //    stays open through justSettled (+ the 2-rAF re-pin tail).
    if (!scopeChanged && (justStoppedThinking || (remounted && !isThinking))) {
      transitionWindowActiveRef.current = true;
    }
    const inWindow = !scopeChanged && transitionWindowActiveRef.current;

    if (container && inWindow) {
      const action = resolveScrollOwnerAction({
        inTransitionWindow: true,
        stuck: stickToBottomRef.current,
        justSettled,
        hasGeometry: lastGeometryRef.current !== null,
      });
      if (action === "pin" || action === "pin-with-rafs") {
        hardPinToBottom();
        if (action === "pin-with-rafs") {
          scheduleRepinChain(hardPinToBottom);
        }
      } else if (action === "restore" && lastGeometryRef.current) {
        restoreHistoryExpansionScrollPosition(container, lastGeometryRef.current);
      }
      if (justSettled) {
        transitionWindowActiveRef.current = false;
      }
    }

    // 4. Record post-decision geometry so the next commit's restore has an
    //    accurate baseline. Keep recording through streaming/finalize/window.
    if (container && (isThinking || isAssistantFinalizing || inWindow)) {
      lastGeometryRef.current = readHistoryExpansionScrollSnapshot(container);
    }

    // 5. Initial pin on scope open (replaces the old initial-pin effect). Marks
    //    the scope before the working/jump guard so opening a busy thread does
    //    not re-pin later — live follow owns it from there.
    if (
      container &&
      initialPinScopeRef.current !== scopeKey &&
      !isHistoryLoading &&
      renderedItemCount > 0
    ) {
      initialPinScopeRef.current = scopeKey;
      if (!isWorkingRef.current && !hasPendingJump) {
        stickToBottomRef.current = true;
        pinToBottomSentinel();
        scheduleRepinChain(pinToBottomSentinel);
      }
    }

    prevSettledRef.current = nowSettled;
    prevIsThinkingRef.current = isThinking;
    prevOmittedRef.current = omittedBeforeWorkingSetCount;
  }, [
    timelinePresentationItems,
    renderedItemCount,
    isThinking,
    isAssistantFinalizing,
    scopeKey,
    isHistoryLoading,
    hasPendingJump,
    omittedBeforeWorkingSetCount,
  ]);

  // Streaming-follow layout effect (replaces the old auto-follow effect). While
  // working/finalizing and stuck, instant-pin the bottom sentinel as DOM-relevant
  // items change so the live tail stays in view. Pre-paint + instant (never
  // smooth), preserving the former effect's observable scrollIntoView behavior.
  useLayoutEffect(() => {
    if (!liveAutoFollowEnabled) {
      return;
    }
    if (!(isWorking || isAssistantFinalizing)) {
      return;
    }
    if (!stickToBottomRef.current) {
      return;
    }
    const bottom = bottomRef.current;
    if (!bottom) {
      return;
    }
    bottom.scrollIntoView({ behavior: "instant", block: "end" });
  }, [
    timelinePresentationItems,
    renderedItemCount,
    isWorking,
    isAssistantFinalizing,
    liveAutoFollowEnabled,
    bottomRef,
  ]);

  const notifyUserScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    stickToBottomRef.current = isMessagesScrollNearBottom(container, SCROLL_THRESHOLD_PX);
    // Refresh the restore baseline too: a user scroll between in-window commits
    // must not be stomped by the next restore using a one-commit-stale snapshot.
    lastGeometryRef.current = readHistoryExpansionScrollSnapshot(container);
  }, [containerRef]);

  const requestFollow = useCallback(() => {
    // Preserves the exact guards of the former requestAutoScroll (called by Bash
    // tool blocks on live output): honor auto-follow, only while working, and
    // never yank a user who has scrolled up.
    if (!liveAutoFollowEnabledRef.current || !isWorkingRef.current) {
      return;
    }
    if (!stickToBottomRef.current) {
      return;
    }
    const bottom = bottomRef.current;
    if (!bottom) {
      return;
    }
    bottom.scrollIntoView({ behavior: "instant", block: "end" });
  }, [bottomRef]);

  const setStick = useCallback((stick: boolean) => {
    stickToBottomRef.current = stick;
  }, []);

  // Turn-start re-arm: when isWorking goes false→true, re-arm stick and follow.
  // Mirrors the former turn-start effect (fires on any working/auto-follow
  // change; the guard no-ops the false transitions).
  useEffect(() => {
    if (!liveAutoFollowEnabled || !isWorking) {
      return;
    }
    stickToBottomRef.current = true;
    requestFollow();
  }, [isWorking, liveAutoFollowEnabled, requestFollow]);

  // Cancel any pending re-pin chain on unmount.
  useEffect(() => {
    return () => {
      if (pinRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(pinRafRef.current);
      }
      pinRafRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({ notifyUserScroll, requestFollow, setStick }),
    [notifyUserScroll, requestFollow, setStick],
  );
}
