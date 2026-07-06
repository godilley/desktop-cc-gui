import { describe, expect, it } from "vitest";

import { resolveActiveMessageAnchor } from "./messagesViewModel";

// resolveActiveMessageAnchor only reads container.scrollTop /
// container.clientHeight and each node's offsetTop, so minimal stand-ins suffice.
function container(scrollTop: number, clientHeight: number) {
  return { scrollTop, clientHeight } as unknown as HTMLDivElement;
}
function nodes(tops: Record<string, number>) {
  const map = new Map<string, HTMLDivElement>();
  for (const [id, offsetTop] of Object.entries(tops)) {
    map.set(id, { offsetTop } as unknown as HTMLDivElement);
  }
  return map;
}

describe("resolveActiveMessageAnchor", () => {
  it("returns null without a container", () => {
    expect(resolveActiveMessageAnchor(null, nodes({ a: 0 }))).toBeNull();
  });

  it("returns null with no anchors", () => {
    expect(resolveActiveMessageAnchor(container(0, 800), nodes({}))).toBeNull();
  });

  it("activates the last anchor whose top is above the viewport centre", () => {
    const map = nodes({ a: 0, b: 2000, c: 4000, d: 4400, e: 4800 });
    // centre = scrollTop + 400
    expect(resolveActiveMessageAnchor(container(1000, 800), map)).toBe("a"); // centre 1400
    expect(resolveActiveMessageAnchor(container(3700, 800), map)).toBe("c"); // centre 4100
  });

  it("keeps the tail reachable — the final few anchors each activate", () => {
    // Regression: a shallow top probe could never bring d/e to the probe line
    // (max scroll is hit first), so they never highlighted. The centre probe does.
    const map = nodes({ a: 0, b: 2000, c: 4000, d: 4400, e: 4800 });
    expect(resolveActiveMessageAnchor(container(4100, 800), map)).toBe("d"); // centre 4500
    expect(resolveActiveMessageAnchor(container(4500, 800), map)).toBe("e"); // centre 4900
  });

  it("falls back to the topmost anchor when scrolled above the first midpoint", () => {
    const map = nodes({ a: 500, b: 5000 });
    // centre = 0 + 300 = 300 < a(500): nothing above centre → topmost anchor.
    expect(resolveActiveMessageAnchor(container(0, 600), map)).toBe("a");
  });
});
