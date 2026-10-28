import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { mountToolGrouping } from "./group-tools.ts";

const hiddenAttribute = "data-bb-minus-hidden";

async function assertToolGrouping({ timelineCount, mountedCount, expectedLabel }) {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const { window } = dom;
  const globals = {
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  const previousGlobals = new Map();
  let dispose;

  try {
    for (const [key, value] of Object.entries(globals)) {
      previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }

    const list = document.createElement("div");
    list.setAttribute("data-timeline-row-list", "top-level");
    const container = document.createElement("div");
    container.setAttribute("data-timeline-items", "");
    const rows = Array.from({ length: mountedCount }, (_, index) => {
      const row = document.createElement("div");
      row.setAttribute("data-timeline-row-id", `thr_test:tool-${index + 1}`);
      container.append(row);
      return row;
    });
    list.append(container);
    document.body.append(list);

    let resolveTimelineLoaded;
    const timelineLoaded = new Promise((resolve) => {
      resolveTimelineLoaded = resolve;
    });
    dispose = mountToolGrouping(async (threadId) => {
      resolveTimelineLoaded(threadId);
      return Array.from({ length: timelineCount }, (_, index) => ({
        id: `${threadId}:tool-${index + 1}`,
        kind: "work",
      }));
    });
    const button = container.querySelector("[data-bb-minus-group] button");

    assert.ok(button, "a collapsed tool-call row is rendered");
    assert.equal(await timelineLoaded, "thr_test");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    assert.equal(button.textContent.replace(/\s+/g, " ").trim(), expectedLabel);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.deepEqual(rows.map((row) => row.hasAttribute(hiddenAttribute)), rows.map(() => true));

    button.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.deepEqual(rows.map((row) => row.hasAttribute(hiddenAttribute)), rows.map(() => false));

    button.click();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.deepEqual(rows.map((row) => row.hasAttribute(hiddenAttribute)), rows.map(() => true));
  } finally {
    dispose?.();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    window.close();
  }
}

for (const [count, expectedLabel] of [
  [1, "Called 1 tool"],
  [2, "Called 2 tools"],
  [3, "Called 3 tools"],
]) {
  test(`renders and expands all mounted rows for ${expectedLabel}`, async () => {
    await assertToolGrouping({ timelineCount: count, mountedCount: count, expectedLabel });
  });
}

test("uses the full timeline count when only one tool row is mounted", async () => {
  await assertToolGrouping({
    timelineCount: 3,
    mountedCount: 1,
    expectedLabel: "Called 3 tools",
  });
});
