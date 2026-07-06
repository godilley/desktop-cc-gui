import { describe, expect, it } from "vitest";
import { resolveScrollOwnerAction } from "./useMessagesScrollOwner";
import {
  readHistoryExpansionScrollSnapshot,
  restoreHistoryExpansionScrollPosition,
  type HistoryExpansionScrollSnapshot,
} from "../components/messagesViewModel";

describe("resolveScrollOwnerAction", () => {
  it("never touches scroll outside the transition window", () => {
    for (const stuck of [true, false]) {
      for (const justSettled of [true, false]) {
        for (const hasGeometry of [true, false]) {
          expect(
            resolveScrollOwnerAction({
              inTransitionWindow: false,
              stuck,
              justSettled,
              hasGeometry,
            }),
          ).toBe("none");
        }
      }
    }
  });

  it("hard-pins while stuck, upgrading to the rAF re-pin chain on the settle commit", () => {
    expect(
      resolveScrollOwnerAction({
        inTransitionWindow: true,
        stuck: true,
        justSettled: false,
        hasGeometry: false,
      }),
    ).toBe("pin");
    expect(
      resolveScrollOwnerAction({
        inTransitionWindow: true,
        stuck: true,
        justSettled: true,
        hasGeometry: true,
      }),
    ).toBe("pin-with-rafs");
  });

  it("restores a scrolled-away user only when a geometry baseline exists", () => {
    expect(
      resolveScrollOwnerAction({
        inTransitionWindow: true,
        stuck: false,
        justSettled: false,
        hasGeometry: true,
      }),
    ).toBe("restore");
    expect(
      resolveScrollOwnerAction({
        inTransitionWindow: true,
        stuck: false,
        justSettled: true,
        hasGeometry: false,
      }),
    ).toBe("none");
  });
});

describe("history expansion scroll delta math", () => {
  function fakeContainer(scrollTop: number, scrollHeight: number) {
    return { scrollTop, scrollHeight } as unknown as HTMLDivElement;
  }

  it("captures a finite {scrollTop, scrollHeight} snapshot", () => {
    expect(readHistoryExpansionScrollSnapshot(fakeContainer(400, 1000))).toEqual({
      scrollTop: 400,
      scrollHeight: 1000,
    });
  });

  it("returns null for a missing container or non-finite geometry", () => {
    expect(readHistoryExpansionScrollSnapshot(null)).toBeNull();
    expect(readHistoryExpansionScrollSnapshot(fakeContainer(Number.NaN, 1000))).toBeNull();
  });

  it("shifts scrollTop by the added-height delta so the viewport content stays put", () => {
    // Snapshot before remount: user scrolled to 400 in a 1000px-tall transcript.
    const snapshot: HistoryExpansionScrollSnapshot = { scrollTop: 400, scrollHeight: 1000 };
    // Full history re-mounts above → total height grows to 3500 (+2500).
    const container = fakeContainer(400, 3500);
    expect(restoreHistoryExpansionScrollPosition(container, snapshot)).toBe(true);
    expect(container.scrollTop).toBe(400 + (3500 - 1000));
  });

  it("clamps a negative restore target (height collapse) to zero", () => {
    const snapshot: HistoryExpansionScrollSnapshot = { scrollTop: 100, scrollHeight: 5000 };
    const container = fakeContainer(100, 1000);
    restoreHistoryExpansionScrollPosition(container, snapshot);
    expect(container.scrollTop).toBe(0);
  });
});
