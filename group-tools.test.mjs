import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { mountToolGrouping } from "./group-tools.ts";
import { QUOTE_SOURCES, QUOTES, pickRandomQuote } from "./quotes.ts";

const HIDDEN = "data-bb-minus-hidden";

function fullId(id) {
  return id.startsWith("thr_") ? id : "thr_test:" + (id.startsWith("tool-") ? "tool:" : "") + id;
}

function makeRow(window, id) {
  const row = window.document.createElement("div");
  row.setAttribute("data-timeline-row-id", fullId(id));
  return row;
}

function mountDom({ rowIds, fetchTimeline, chooseQuote = () => QUOTES[0], clock, subscribeTimeline }) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://bb.local/",
  });
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
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  const list = window.document.createElement("div");
  list.setAttribute("data-timeline-row-list", "top-level");
  const container = window.document.createElement("div");
  container.setAttribute("data-timeline-items", "");
  const rows = rowIds.map((id) => makeRow(window, id));
  container.append(...rows);
  list.append(container);
  window.document.body.append(list);
  const dispose = mountToolGrouping(fetchTimeline, chooseQuote, clock, subscribeTimeline);

  return {
    window,
    container,
    rows,
    dispose,
    makeRow: (id) => makeRow(window, id),
    async flush() {
      for (let index = 0; index < 2; index++) {
        await Promise.resolve();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
    },
    cleanup() {
      dispose();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      window.close();
    },
  };
}

function timeline(rows) {
  return rows.map(([id, kind = "work", operationKind, startedAt = 1000, completedAt = 1300, workKind]) => ({
    id: fullId(id),
    kind,
    startedAt,
    ...(kind === "work" ? {
      completedAt,
      status: completedAt === null ? "pending" : "completed",
    } : {}),
    ...(operationKind === undefined ? {} : { operationKind }),
    ...(workKind === undefined ? {} : { workKind }),
  }));
}

function makeClock(startAt) {
  let now = startAt;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delayMs });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

for (const count of [1, 2, 3]) {
  test("renders and toggles every mounted row for " + count + " tool call(s)", async () => {
    const rowIds = Array.from({ length: count }, (_, index) => "tool-" + (index + 1));
    const dom = mountDom({
      rowIds,
      fetchTimeline: async () => timeline(rowIds.map((id) => [id])),
    });
    try {
      await dom.flush();
      const marker = dom.container.querySelector("[data-bb-minus-group]");
      const button = marker.querySelector("button");
      const quote = marker.querySelector("[data-quote]");
      const source = marker.querySelector("[data-source]");
      const metrics = marker.querySelector("[data-metrics]");
      assert.deepEqual([...marker.querySelector("[data-row]").children].map(el => el.tagName), ["BUTTON", "A", "BUTTON"]);
      assert.equal(marker.textContent.includes("Called"), false);
      assert.ok(button.classList.contains("text-subtle-foreground"));
      assert.ok(quote.classList.contains("text-subtle-foreground"));
      assert.ok(metrics.classList.contains("text-subtle-foreground"));
      assert.equal(
        button.getAttribute("aria-label"),
        "Show " + count + " tool call" + (count === 1 ? "" : "s") + ". Total tool time: " +
          count * 300 + "ms.",
      );
      assert.equal(
        metrics.textContent,
        count + " tool" + (count === 1 ? "" : "s") + " · " + count * 300 + "ms",
      );
      assert.equal(button.getAttribute("aria-describedby"), quote.id);
      assert.equal(quote.textContent, QUOTES[0].text);
      assert.equal(quote.title, QUOTES[0].text);
      assert.ok(quote.classList.contains("italic"));
      assert.equal(source.textContent, QUOTE_SOURCES[QUOTES[0].source].byline);
      assert.equal(source.href, QUOTE_SOURCES[QUOTES[0].source].url);
      assert.equal(source.target, "_blank");
      assert.equal(source.rel, "noopener noreferrer");
      assert.ok(source.classList.contains("text-subtle-foreground"));
      assert.ok(source.classList.contains("underline"));
      assert.equal(source.classList.contains("text-primary"), false);
      assert.ok(button.classList.contains("focus-visible:ring-1"));
      assert.ok(source.classList.contains("focus-visible:ring-1"));
      assert.equal(button.contains(source), false);
      source.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
      await dom.flush();
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.ok(source.getAttribute("aria-label").includes("Русский перевод Minus"));
      assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), rowIds.map(() => true));

      button.click();
      await dom.flush();
      assert.equal(button.getAttribute("aria-expanded"), "true");
      assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), rowIds.map(() => false));

      button.click();
      await dom.flush();
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), rowIds.map(() => true));
    } finally {
      dom.cleanup();
    }
  });
}

test("uses the full timeline count when only one tool row is mounted", async () => {
  const dom = mountDom({
    rowIds: ["tool-2"],
    fetchTimeline: async () => timeline([["tool-1"], ["tool-2"], ["tool-3"]]),
  });
  try {
    await dom.flush();
    const marker = dom.container.querySelector("[data-bb-minus-group]");
    assert.equal(
      marker.querySelector("button").getAttribute("aria-label"),
      "Show 3 tool calls. Total tool time: 900ms.",
    );
    assert.equal(marker.textContent.includes("Called"), false);
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
    marker.querySelector("button").click();
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
  } finally {
    dom.cleanup();
  }
});

test("shows the sum of individual tool runtimes rather than group wall time", async () => {
  const rowIds = ["tool-1", "tool-2"];
  const dom = mountDom({
    rowIds,
    fetchTimeline: async () => timeline([
      ["tool-1", "work", undefined, 1000, 2500],
      ["tool-2", "work", undefined, 1500, 3000],
    ]),
  });
  try {
    await dom.flush();
    const marker = dom.container.querySelector("[data-bb-minus-group]");
    const metrics = marker.querySelector("[data-metrics]");
    assert.equal(metrics.textContent, "2 tools · 3s");
    assert.ok(metrics.title.includes("parallel calls are added together"));
    assert.match(marker.querySelector("button").getAttribute("aria-label"), /Total tool time: 3s/);
  } finally {
    dom.cleanup();
  }
});

test("updates the visible duration while a tool call is pending", async () => {
  const clock = makeClock(10000);
  const rowIds = ["tool-1"];
  let fetchCount = 0;
  const dom = mountDom({
    rowIds,
    clock,
    fetchTimeline: async () => {
      fetchCount++;
      return fetchCount === 1
        ? timeline([["tool-1", "work", undefined, 10000, null]])
        : timeline([["tool-1", "work", undefined, 10000, 11500]]);
    },
  });
  try {
    await dom.flush();
    const metrics = dom.container.querySelector("[data-metrics]");
    assert.equal(metrics.textContent, "1 tool · 0ms");
    clock.advance(2000);
    await dom.flush();
    assert.equal(fetchCount, 2);
    assert.equal(metrics.textContent, "1 tool · 1.5s");
  } finally {
    dom.cleanup();
  }
});

test("keeps a manual stop visible and outside collapsed tool-call groups", async () => {
  const rowIds = ["tool-1", "op:thread-interrupted:manual-stop", "tool-2"];
  const dom = mountDom({
    rowIds,
    fetchTimeline: async () => timeline([
      ["tool-1", "work", undefined, 1000, 1500],
      ["op:thread-interrupted:manual-stop", "system", "thread-interrupted"],
      ["tool-2", "work", undefined, 1000, 2500],
    ]),
  });
  const stopRow = dom.rows[1];
  stopRow.textContent = "Stopped manually";
  try {
    const assertGroupsAndStop = () => {
      const markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
      assert.equal(markers.length, 2);
      assert.ok(markers.every((marker) =>
        marker.querySelector("button").getAttribute("aria-label").startsWith("Show 1 tool call."),
      ));
      assert.equal(stopRow.textContent, "Stopped manually");
      assert.equal(stopRow.hasAttribute(HIDDEN), false);
    };

    assertGroupsAndStop(); // DOM fallback before the timeline API resolves.
    await dom.flush();
    assertGroupsAndStop(); // API-backed grouping keeps the system row as a boundary.
    assert.deepEqual(
      [...dom.container.querySelectorAll("[data-metrics]")].map((metrics) => metrics.textContent),
      ["1 tool · 500ms", "1 tool · 1.5s"],
    );

    const buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")];
    buttons[0].click();
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), false);
    assert.equal(dom.rows[2].hasAttribute(HIDDEN), true);

    buttons[1].click();
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), false);
    assert.equal(dom.rows[2].hasAttribute(HIDDEN), false);

    buttons[0].click();
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), false);
    assert.equal(dom.rows[2].hasAttribute(HIDDEN), false);
  } finally {
    dom.cleanup();
  }
});

test("splits a virtualized tool run at an API interruption boundary", async () => {
  let rejectFirstTimeline;
  let resolveTimeline;
  const firstTimeline = new Promise((_, reject) => { rejectFirstTimeline = reject; });
  const clock = makeClock(1000);
  let fetchCount = 0;
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2"],
    clock,
    fetchTimeline: () => {
      fetchCount++;
      return fetchCount === 1
        ? firstTimeline
        : new Promise((resolve) => { resolveTimeline = resolve; });
    },
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[1]);
  try {
    await dom.flush();
    let markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.equal(markers.length, 2);
    assert.equal(
      markers[0].querySelector("button").getAttribute("aria-label"),
      "Show 1 tool call. Total tool time: time unavailable.",
    );
    assert.equal(markers[1].querySelector("button").getAttribute("aria-label"),
      "Show 1 tool call. Total tool time: time unavailable.");
    assert.equal(spacer.hasAttribute(HIDDEN), false);

    rejectFirstTimeline(new Error("timeline temporarily unavailable"));
    await dom.flush();
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 2);

    clock.advance(2000);
    await dom.flush();
    assert.equal(fetchCount, 2);

    resolveTimeline(timeline([
      ["tool-1"],
      ["op:thread-interrupted:manual-stop", "system", "thread-interrupted"],
      ["tool-2"],
    ]));
    await dom.flush();

    markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.equal(markers.length, 2);
    assert.deepEqual(
      markers.map((marker) => marker.querySelector("button").getAttribute("aria-label")),
      [
        "Show 1 tool call. Total tool time: 300ms.",
        "Show 1 tool call. Total tool time: 300ms.",
      ],
    );
    assert.equal(spacer.hasAttribute(HIDDEN), false);
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [true, true]);

    markers[1].querySelector("button").click();
    await dom.flush();
    assert.equal(spacer.hasAttribute(HIDDEN), false);
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [true, false]);
  } finally {
    dom.cleanup();
  }
});

test("keeps an expanded API group open after refresh rejection and recovery", async () => {
  const clock = makeClock(10000);
  let fetchCount = 0;
  const dom = mountDom({
    rowIds: ["tool-1"], clock,
    fetchTimeline: async () => {
      fetchCount++;
      if (fetchCount === 2) throw new Error("refresh temporarily unavailable");
      return timeline([["tool-1", "work", undefined, 10000, null]]);
    },
  });
  try {
    await dom.flush();
    dom.container.querySelector("button").click();
    await dom.flush();
    for (const advance of [2000, 2000]) {
      clock.advance(advance);
      await dom.flush();
      assert.equal(dom.container.querySelector("button").getAttribute("aria-expanded"), "true");
      assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
    }
    assert.equal(fetchCount, 3);
    dom.container.querySelector("button").click();
    await dom.flush();
    clock.advance(2000);
    await dom.flush();
    assert.equal(dom.container.querySelector("button").getAttribute("aria-expanded"), "false");
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
  } finally { dom.cleanup(); }
});

test("keeps an expanded right fallback part open when the API joins both parts", async () => {
  let resolveTimeline;
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2"],
    fetchTimeline: () => new Promise((resolve) => { resolveTimeline = resolve; }),
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[1]);
  try {
    await dom.flush();
    const buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")];
    assert.equal(buttons.length, 2);
    buttons[1].click();
    await dom.flush();
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [true, false]);
    resolveTimeline(timeline([["tool-1"], ["tool-2"]]));
    await dom.flush();
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 1);
    assert.equal(dom.container.querySelector("button").getAttribute("aria-expanded"), "true");
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [false, false]);
    dom.container.querySelector("button").click();
    await dom.flush();
    assert.equal(dom.container.querySelector("button").getAttribute("aria-expanded"), "false");
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [true, true]);
  } finally { dom.cleanup(); }
});

test("does not revive a stale fallback choice when an unmounted row returns", async () => {
  let resolveTimeline;
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2"],
    fetchTimeline: () => new Promise((resolve) => { resolveTimeline = resolve; }),
  });
  try {
    await dom.flush();
    dom.container.querySelector("button").click();
    await dom.flush();
    dom.rows[1].remove();
    await dom.flush();
    resolveTimeline(timeline([["tool-1"], ["tool-2"]]));
    await dom.flush();
    assert.equal(dom.container.querySelector("button").getAttribute("aria-expanded"), "true");
    dom.container.querySelector("button").click();
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
    dom.container.append(dom.rows[1]);
    await dom.flush();
    assert.equal(dom.container.querySelector("button").getAttribute("aria-expanded"), "false");
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [true, true]);
  } finally { dom.cleanup(); }
});

test("keeps all split groups expanded when the API resolves after fallback expansion", async () => {
  let resolveTimeline;
  const timelineResult = new Promise((resolve) => { resolveTimeline = resolve; });
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2"],
    fetchTimeline: () => timelineResult,
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[1]);
  try {
    await dom.flush();
    const fallbackButtons = [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")];
    assert.equal(fallbackButtons.length, 2);
    fallbackButtons.forEach((button) => button.click());
    await dom.flush();
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [false, false]);

    resolveTimeline(timeline([
      ["tool-1"],
      ["op:thread-interrupted:manual-stop", "system", "thread-interrupted"],
      ["tool-2"],
    ]));
    await dom.flush();

    const markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.equal(markers.length, 2);
    assert.deepEqual(
      markers.map((marker) => marker.querySelector("button").getAttribute("aria-expanded")),
      ["true", "true"],
    );
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [false, false]);

    markers[1].querySelector("button").click();
    await dom.flush();
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [false, true]);
  } finally {
    dom.cleanup();
  }
});

test("preserves a known API boundary when one mounted tool id is missing", async () => {
  const dom = mountDom({
    rowIds: ["tool-1", "tool-unknown", "tool-3"],
    fetchTimeline: async () => timeline([
      ["tool-1"],
      ["op:thread-interrupted:manual-stop", "system", "thread-interrupted"],
      ["tool-3"],
    ]),
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[2]);
  try {
    await dom.flush();
    const markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.equal(markers.length, 3);
    assert.deepEqual(
      markers.map((marker) => marker.querySelector("button").getAttribute("aria-label")),
      [
        "Show 1 tool call. Total tool time: 300ms.",
        "Show 1 tool call. Total tool time: time unavailable.",
        "Show 1 tool call. Total tool time: 300ms.",
      ],
    );
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [true, true, true]);
    assert.equal(spacer.hasAttribute(HIDDEN), false);
  } finally {
    dom.cleanup();
  }
});

test("counts an uncached mounted tool row without duplicating its run toggle", async () => {
  const dom = mountDom({
    rowIds: ["tool-1", "tool-unknown", "tool-2"],
    fetchTimeline: async () => timeline([["tool-1"], ["tool-2"]]),
  });
  try {
    await dom.flush();
    const markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.equal(markers.length, 1);
    assert.equal(
      markers[0].querySelector("button").getAttribute("aria-label"),
      "Show 3 tool calls. Total tool time: time unavailable.",
    );
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [true, true, true]);

    markers[0].querySelector("button").click();
    await dom.flush();
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), [false, false, false]);
  } finally {
    dom.cleanup();
  }
});

test("does not reopen a collapsed API group when virtualization replaces its first row", async () => {
  let resolveTimeline;
  const timelineResult = new Promise((resolve) => { resolveTimeline = resolve; });
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2"],
    fetchTimeline: () => timelineResult,
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[1]);
  try {
    await dom.flush();
    const fallbackButtons = [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")];
    assert.equal(fallbackButtons.length, 2);
    fallbackButtons[0].click();
    fallbackButtons[1].click();
    await dom.flush();
    resolveTimeline(timeline([
      ["tool-1"],
      ["tool-1b"],
      ["op:thread-interrupted:manual-stop", "system", "thread-interrupted"],
      ["tool-2"],
    ]));
    await dom.flush();

    let markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.deepEqual(
      markers.map((marker) => marker.querySelector("button").getAttribute("aria-expanded")),
      ["true", "true"],
    );
    markers[1].querySelector("button").click();
    await dom.flush();
    assert.deepEqual(
      [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")].map((button) => button.getAttribute("aria-expanded")),
      ["true", "false"],
    );

    const replacement = dom.makeRow("tool-1b");
    dom.rows[0].replaceWith(replacement);
    await dom.flush();

    markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.deepEqual(
      markers.map((marker) => marker.querySelector("button").getAttribute("aria-expanded")),
      ["true", "false"],
    );
    assert.equal(replacement.hasAttribute(HIDDEN), false);
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), true);
  } finally {
    dom.cleanup();
  }
});

test("does not expand a newly visible API group when virtualization shifts the mounted range", async () => {
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2"],
    fetchTimeline: async () => timeline([
      ["tool-1"],
      ["op:thread-interrupted:one", "system", "thread-interrupted"],
      ["tool-2"],
      ["op:thread-interrupted:two", "system", "thread-interrupted"],
      ["tool-3"],
    ]),
  });
  try {
    await dom.flush();
    let buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")];
    assert.equal(buttons.length, 2);
    buttons[1].click();
    await dom.flush();
    assert.deepEqual(buttons.map((button) => button.getAttribute("aria-expanded")), ["false", "true"]);

    dom.rows[0].remove();
    const newlyVisible = dom.makeRow("tool-3");
    dom.container.append(newlyVisible);
    await dom.flush();

    buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")];
    assert.equal(buttons.length, 2);
    assert.deepEqual(buttons.map((button) => button.getAttribute("aria-expanded")), ["true", "false"]);
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), false);
    assert.equal(newlyVisible.hasAttribute(HIDDEN), true);
  } finally {
    dom.cleanup();
  }
});

test("transfers an expanded fallback row once so it can still be collapsed", async () => {
  let resolveTimeline;
  const timelineResult = new Promise((resolve) => { resolveTimeline = resolve; });
  const rowIds = ["tool-1", "tool-2", "tool-3"];
  const dom = mountDom({
    rowIds,
    fetchTimeline: () => timelineResult,
  });
  try {
    await dom.flush();
    let button = dom.container.querySelector("[data-bb-minus-group] button");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    button.click();
    await dom.flush();
    assert.equal(button.getAttribute("aria-expanded"), "true");

    resolveTimeline(timeline(rowIds.map((id) => [id])));
    await dom.flush();
    button = dom.container.querySelector("[data-bb-minus-group] button");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), rowIds.map(() => false));

    button.click();
    await dom.flush();
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.deepEqual(dom.rows.map((row) => row.hasAttribute(HIDDEN)), rowIds.map(() => true));
  } finally {
    dom.cleanup();
  }
});

test("keeps the quote stable when virtualization mounts another row in the same run", async () => {
  let chooseCount = 0;
  const dom = mountDom({
    rowIds: ["tool-1"],
    fetchTimeline: async () => timeline([["tool-1"], ["tool-2"], ["tool-3"]]),
    chooseQuote: () => QUOTES[chooseCount++],
  });
  try {
    await dom.flush();
    const before = dom.container.querySelector("[data-quote]").textContent;
    const spacer = dom.window.document.createElement("div");
    spacer.setAttribute("data-timeline-window-spacer", "");
    const nextRow = dom.makeRow("tool-2");
    dom.container.append(nextRow);
    dom.container.insertBefore(spacer, nextRow);
    await dom.flush();
    const after = dom.container.querySelector("[data-quote]").textContent;
    assert.equal(after, before);
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 1);
    assert.equal(dom.container.querySelector("[data-metrics]").textContent, "3 tools · 900ms");
    assert.equal(chooseCount, 1);
  } finally {
    dom.cleanup();
  }
});

test("keeps separate tool runs independently expandable", async () => {
  const rowIds = ["tool-1", "assistant-1", "tool-2"];
  const dom = mountDom({
    rowIds,
    fetchTimeline: async () => timeline([["tool-1"], ["assistant-1", "assistant"], ["tool-2"]]),
    chooseQuote: (() => {
      let index = 0;
      return () => QUOTES[index++];
    })(),
  });
  try {
    await dom.flush();
    const markers = dom.container.querySelectorAll("[data-bb-minus-group]");
    assert.equal(markers.length, 2);
    markers[1].querySelector("button").click();
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), false);
    assert.equal(dom.rows[2].hasAttribute(HIDDEN), false);
  } finally {
    dom.cleanup();
  }
});

test("keeps reasoning and unknown live rows visible before, during and after the API response", async () => {
  let resolveTimeline;
  const dom = mountDom({
    rowIds: ["tool-1", "op:reasoning:live", "live-agent-stream", "tool-2"],
    fetchTimeline: () => new Promise(resolve => { resolveTimeline = resolve; }),
  });
  try {
    dom.rows[1].textContent = "Проверяю результат агента";
    dom.rows[2].textContent = "Промежуточный ответ";
    await dom.flush();
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [true, false, false, true]);
    resolveTimeline(timeline([["tool-1"], ["op:reasoning:live", "system", "reasoning"], ["live-agent-stream", "system"], ["tool-2"]]));
    await dom.flush();
    dom.rows[1].append(" — поток продолжается");
    dom.rows[2].append(" — новые данные");
    await dom.flush();
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [true, false, false, true]);
    const buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")];
    assert.equal(buttons.length, 2);
    assert.ok(buttons.every(button => button.getAttribute("aria-label") === "Show 1 tool call. Total tool time: 300ms."));
    buttons[0].click();
    await dom.flush();
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [false, false, false, true]);
  } finally { dom.cleanup(); }
});

test("does not join tool runs across virtualized reasoning", async () => {
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2"],
    fetchTimeline: async () => timeline([["tool-1"], ["op:reasoning:virtual", "system", "reasoning"], ["tool-2"]]),
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[1]);
  try {
    await dom.flush();
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 2);
    assert.equal(spacer.hasAttribute(HIDDEN), false);
  } finally { dom.cleanup(); }
});

test("an uncached tool cannot bridge a spacer containing an agent stream", async () => {
  const dom = mountDom({
    rowIds: ["tool-uncached", "tool-right"],
    fetchTimeline: async () => timeline([["tool-left"], ["delegation:child", "work", undefined, 1000, null, "delegation"], ["tool-right"]]),
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[1]);
  try {
    await dom.flush();
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 2);
    assert.equal(spacer.hasAttribute(HIDDEN), false);
    assert.deepEqual([...dom.container.querySelectorAll("[data-metrics]")].map(x => x.textContent), ["1 tool · time unavailable", "1 tool · 300ms"]);
  } finally { dom.cleanup(); }
});

test("a work row acquiring nested agent content becomes a visible independent boundary", async () => {
  const dom = mountDom({
    rowIds: ["tool-1", "tool-agent", "tool-2"],
    fetchTimeline: async () => timeline([["tool-1"], ["tool-agent"], ["tool-2"]]),
  });
  try {
    await dom.flush();
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 1);
    const list = dom.window.document.createElement("div");
    list.setAttribute("data-timeline-row-list", "child");
    const items = dom.window.document.createElement("div");
    items.setAttribute("data-timeline-items", "");
    const message = dom.makeRow("assistant:kind:assistant|stream");
    message.textContent = "Агент проверил первый файл";
    items.append(message);
    list.append(items);
    dom.rows[1].append(list);
    await dom.flush();
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [true, false, true]);
    const markers = [...dom.container.querySelectorAll(":scope > [data-bb-minus-group]")];
    assert.equal(markers.length, 2);
    assert.ok(markers.every(marker => marker.querySelector("[data-metrics]").textContent === "1 tool · 300ms"));
    assert.equal(message.hasAttribute(HIDDEN), false);
    message.append("; проверяю следующий");
    await dom.flush();
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), false);
    markers[1].querySelector("button").click();
    await dom.flush();
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [true, false, false]);
  } finally { dom.cleanup(); }
});

test("agent stream work and user interactions stay visible with their own API boundaries", async () => {
  for (const workKind of ["delegation", "workflow", "approval", "question", "form"]) {
    const dom = mountDom({
      rowIds: ["tool-1", workKind + ":live", "tool-2"],
      fetchTimeline: async () => timeline([["tool-1"], [workKind + ":live", "work", undefined, 1000, null, workKind], ["tool-2"]]),
    });
    try {
      await dom.flush();
      assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [true, false, true], workKind);
      assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 2, workKind);
    } finally { dom.cleanup(); }
  }
});

test("keeps the end divider after the last mounted call as calls appear and disappear", async () => {
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2", "assistant:after"],
    fetchTimeline: async () => timeline([["tool-1"], ["tool-2"], ["assistant:after", "conversation"]]),
  });
  try {
    await dom.flush();
    assert.equal(dom.container.querySelector("[data-bb-minus-group-end]"), null);
    const button = dom.container.querySelector("[data-bb-minus-group] button");
    button.click();
    await dom.flush();
    const end = dom.container.querySelector("[data-bb-minus-group-end]");
    assert.equal(end.getAttribute("aria-hidden"), "true");
    assert.equal(end.previousElementSibling, dom.rows[1]);
    assert.equal(end.nextElementSibling, dom.rows[2]);
    const returning = dom.makeRow("tool-3");
    dom.container.insertBefore(returning, dom.rows[2]);
    await dom.flush();
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group-end]").length, 1);
    assert.equal(end.previousElementSibling, returning);
    assert.equal(end.nextElementSibling, dom.rows[2]);
    returning.remove();
    await dom.flush();
    assert.equal(end.previousElementSibling, dom.rows[1]);
    button.click();
    await dom.flush();
    assert.equal(dom.container.querySelector("[data-bb-minus-group-end]"), null);
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [true, true, false]);
  } finally { dom.cleanup(); }
});

test("keeps independent dividers outside the agent stream through virtualization", async () => {
  const dom = mountDom({
    rowIds: ["tool-1", "op:reasoning:live", "tool-2"],
    fetchTimeline: async () => timeline([["tool-1"], ["op:reasoning:live", "system", "reasoning"], ["tool-2"]]),
  });
  try {
    await dom.flush();
    for (const button of dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")) button.click();
    await dom.flush();
    let ends = [...dom.container.querySelectorAll("[data-bb-minus-group-end]")];
    assert.equal(ends.length, 2);
    assert.equal(ends[0].previousElementSibling, dom.rows[0]);
    assert.equal(ends[0].nextElementSibling, dom.rows[1]);
    assert.equal(ends[1].previousElementSibling, dom.rows[2]);
    dom.rows[0].remove();
    await dom.flush();
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group-end]").length, 1);
    assert.equal(dom.rows[1].hasAttribute(HIDDEN), false);
    dom.container.insertBefore(dom.rows[0], dom.rows[1]);
    await dom.flush();
    ends = [...dom.container.querySelectorAll("[data-bb-minus-group-end]")];
    assert.equal(ends.length, 2);
    assert.equal(ends[0].previousElementSibling, dom.rows[0]);
    assert.equal(ends[0].nextElementSibling, dom.rows[1]);
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [false, false, false]);
  } finally { dom.cleanup(); }
});

for (const boundary of ["pending-spacer", "stale-reasoning"]) {
  test("settles independent headers and dividers for " + boundary + " parts sharing an API run", async () => {
    const clock = makeClock(10000);
    const pending = boundary === "pending-spacer";
    const rowIds = pending
      ? ["tool-1", "tool-2", "assistant:after"]
      : ["tool-1", "op:reasoning:live", "tool-2", "assistant:after"];
    const dom = mountDom({
      rowIds, clock,
      fetchTimeline: async () => timeline([
        ["tool-1", "work", undefined, 1000, pending ? null : 1300],
        ["tool-2", "work", undefined, 1000, pending ? null : 1300],
        ["assistant:after", "conversation"],
      ]),
    });
    const left = dom.rows[0], right = dom.rows[pending ? 1 : 2];
    const separator = pending ? dom.window.document.createElement("div") : dom.rows[1];
    if (pending) {
      separator.setAttribute("data-timeline-window-spacer", "");
      dom.container.insertBefore(separator, right);
    }
    const originalRaf = globalThis.requestAnimationFrame;
    let requested = 0;
    globalThis.requestAnimationFrame = callback => { requested++; return originalRaf(callback); };
    try {
      await dom.flush();
      const markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
      assert.equal(markers.length, 2);
      assert.equal(markers[0].nextElementSibling, left);
      assert.equal(markers[1].nextElementSibling, right);
      const settledClosed = requested;
      await dom.flush();
      assert.equal(requested, settledClosed, "closed DOM must not schedule itself forever");
      for (const marker of markers) marker.querySelector("button").click();
      await dom.flush();
      const ends = [...dom.container.querySelectorAll("[data-bb-minus-group-end]")];
      assert.equal(ends.length, 2);
      assert.equal(ends[0].previousElementSibling, left);
      assert.equal(ends[0].nextElementSibling, separator);
      assert.equal(ends[1].previousElementSibling, right);
      assert.equal(separator.hasAttribute(HIDDEN), false);
      const settledOpen = requested;
      await dom.flush();
      assert.equal(requested, settledOpen, "open DOM must not schedule itself forever");
    } finally { dom.cleanup(); }
  });
}

for (const failRefresh of [false, true]) {
  test("a returning fallback part keeps the latest API collapse" + (failRefresh ? " after API failure" : ""), async () => {
    const clock = makeClock(10000);
    let rejectRefresh = false;
    const dom = mountDom({
      rowIds: ["tool-1", "tool-2", "assistant:after"], clock,
      fetchTimeline: async () => {
        if (rejectRefresh) throw new Error("refresh failed");
        return timeline([["tool-1", "work", undefined, 1000, null], ["tool-2", "work", undefined, 1000, null], ["assistant:after", "conversation"]]);
      },
    });
    const spacer = dom.window.document.createElement("div");
    spacer.setAttribute("data-timeline-window-spacer", "");
    dom.container.insertBefore(spacer, dom.rows[1]);
    try {
      await dom.flush();
      for (const button of dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")) button.click();
      await dom.flush();
      assert.equal(dom.container.querySelectorAll("[data-bb-minus-group-end]").length, 2);
      dom.rows[1].remove();
      await dom.flush();
      assert.equal(dom.container.querySelectorAll("[data-bb-minus-group]").length, 1);
      const apiButton = dom.container.querySelector("[data-bb-minus-group] button");
      assert.equal(apiButton.getAttribute("aria-expanded"), "true");
      apiButton.click();
      await dom.flush();
      if (failRefresh) {
        rejectRefresh = true;
        clock.advance(2000);
        await dom.flush();
      }
      dom.container.insertBefore(dom.rows[1], dom.rows[2]);
      await dom.flush();
      assert.deepEqual([...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")].map(x => x.getAttribute("aria-expanded")), ["false", "false"]);
      assert.equal(dom.container.querySelectorAll("[data-bb-minus-group-end]").length, 0);
      assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
      assert.equal(dom.rows[1].hasAttribute(HIDDEN), true);
      assert.equal(spacer.hasAttribute(HIDDEN), false);
    } finally { dom.cleanup(); }
  });
}

test("keeps the rendered API membership when collapse happens after rejection but before its RAF", async () => {
  const clock = makeClock(10000);
  let rejectRefresh = false;
  const dom = mountDom({
    rowIds: ["tool-1", "tool-2", "assistant:after"], clock,
    fetchTimeline: async () => {
      if (rejectRefresh) throw new Error("refresh failed before render");
      return timeline([["tool-1", "work", undefined, 1000, null], ["tool-2", "work", undefined, 1000, null], ["assistant:after", "conversation"]]);
    },
  });
  const spacer = dom.window.document.createElement("div");
  spacer.setAttribute("data-timeline-window-spacer", "");
  dom.container.insertBefore(spacer, dom.rows[1]);
  const originalRaf = globalThis.requestAnimationFrame;
  try {
    await dom.flush();
    for (const button of dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")) button.click();
    await dom.flush();
    dom.rows[1].remove();
    await dom.flush();
    const button = dom.container.querySelector("[data-bb-minus-group] button");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    const queued = [];
    let frameId = 0;
    globalThis.requestAnimationFrame = callback => { queued.push(callback); return ++frameId; };
    rejectRefresh = true;
    clock.advance(2000);
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
    assert.equal(queued.length, 1, "hold the first render after rejection");
    button.click();
    globalThis.requestAnimationFrame = originalRaf;
    for (const callback of queued.splice(0)) callback(dom.window.performance.now());
    await dom.flush();
    dom.container.insertBefore(dom.rows[1], dom.rows[2]);
    await dom.flush();
    assert.deepEqual([...dom.container.querySelectorAll("[data-bb-minus-group] [data-toggle=quote]")].map(x => x.getAttribute("aria-expanded")), ["false", "false"]);
    assert.equal(dom.container.querySelectorAll("[data-bb-minus-group-end]").length, 0);
    assert.deepEqual(dom.rows.map(row => row.hasAttribute(HIDDEN)), [true, true, false]);
  } finally { globalThis.requestAnimationFrame = originalRaf; dom.cleanup(); }
});

for (const focusSelector of ["button", "[data-source]", "[data-toggle=metrics]"]) {
  test("keeps focus on " + focusSelector + " when an expanded fallback becomes an API group", async () => {
    let resolveTimeline;
    const dom = mountDom({
      rowIds: ["tool-1"],
      fetchTimeline: () => new Promise(resolve => { resolveTimeline = resolve; }),
    });
    try {
      await dom.flush();
      const previous = dom.container.querySelector("[data-bb-minus-group]");
      previous.querySelector("button").click();
      await dom.flush();
      previous.querySelector(focusSelector).focus();
      resolveTimeline(timeline([["tool-1"]]));
      await dom.flush();
      const current = dom.container.querySelector("[data-bb-minus-group]");
      assert.notEqual(current, previous);
      assert.equal(dom.window.document.activeElement, current.querySelector(focusSelector));
      assert.equal(current.querySelector("button").getAttribute("aria-expanded"), "true");
    } finally { dom.cleanup(); }
  });
}

test("dispose restores rows and removes injected DOM", async () => {
  const dom = mountDom({
    rowIds: ["tool-1"],
    fetchTimeline: async () => timeline([["tool-1"]]),
  });
  try {
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
    assert.ok(dom.window.document.head.querySelector("style"));
    dom.container.querySelector("[data-bb-minus-group] button").click();
    await dom.flush();
    assert.ok(dom.container.querySelector("[data-bb-minus-group-end]"));
    dom.dispose();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
    assert.equal(dom.container.querySelector("[data-bb-minus-group]"), null);
    assert.equal(dom.container.querySelector("[data-bb-minus-group-end]"), null);
    assert.equal(dom.window.document.head.querySelector("style"), null);
  } finally {
    dom.cleanup();
  }
});

test("all quotes have unique excerpts and a source with a line locator", () => {
  const ids = QUOTES.map((quote) => quote.id);
  const originals = QUOTES.map((quote) => quote.original);
  assert.ok(QUOTES.length > 0);
  assert.equal(new Set(ids).size, QUOTES.length);
  assert.equal(new Set(originals).size, QUOTES.length);
  for (const source of Object.values(QUOTE_SOURCES)) {
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "www.gutenberg.org");
    assert.ok(source.byline.trim().length > 0);
    assert.ok(source.credit.trim().length > 0);
    assert.ok(source.title.trim().length > 0);
  }
  for (const quote of QUOTES) {
    assert.ok(quote.text.trim().length > 0);
    assert.ok(quote.original.trim().length > 0);
    assert.ok(quote.locator.includes("Project Gutenberg plain-text line "));
    assert.ok(Object.hasOwn(QUOTE_SOURCES, quote.source));
    const ebookId = QUOTE_SOURCES[quote.source].url.split("/").pop();
    assert.ok(Number.isInteger(Number(ebookId)));
  }
});

test("quote selection covers the first and last entries at random bounds", () => {
  assert.equal(pickRandomQuote(() => 0), QUOTES[0]);
  assert.equal(pickRandomQuote(() => 0.999999), QUOTES[QUOTES.length - 1]);
});

test("reviewed translations preserve every clause from their source excerpts", () => {
  const reviewed = new Map([
    ["dhammapada-9a0c48f9874c", "Если человек говорит или поступает с чистой мыслью, за ним следует счастье — как неотступная тень."],
    ["selfhelp-e14ffcf3a546", "Утраченное богатство можно вернуть трудом, знания — учёбой, здоровье — умеренностью или лекарствами, но потерянное время не вернуть."],
    ["selfhelp-63df51d1c93a", "Самодисциплина и самообладание — начало практической мудрости; их корень — уважение к себе."],
  ]);

  for (const [id, text] of reviewed) {
    assert.equal(QUOTES.find((quote) => quote.id === id)?.text, text, id);
  }
});

function attachCompletedTurn(dom, row, ids, initiallyOpen = false) {
  const w = dom.window;
  const root = w.document.createElement('div');
  const header = w.document.createElement('div');
  header.className = 'group/timeline-row';
  const button = w.document.createElement('button');
  button.textContent = 'Worked for 3s';
  button.setAttribute('aria-expanded', String(initiallyOpen));
  header.append(button);
  const body = w.document.createElement('div');
  const list = w.document.createElement('div');
  list.setAttribute('data-timeline-row-list', 'nested');
  const items = w.document.createElement('div');
  items.setAttribute('data-timeline-items', '');
  const rows = ids.map(id => {
    const el = dom.makeRow(id);
    el.textContent = id.startsWith('assistant:') ? 'Полезное промежуточное сообщение' : 'Вызов инструмента';
    if (id.startsWith('assistant:')) el.className = 'group/message';
    return el;
  });
  items.append(...rows);
  list.append(items);
  if (initiallyOpen) body.append(list);
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    body.replaceChildren(...(open ? [list] : []));
  });
  root.append(header, body);
  row.replaceChildren(root);
  return { button, rows, items, list };
}

test('keeps completed-turn commentary visible while hiding its tools with final timings', async () => {
  const ids = ['assistant:progress', 'tool-1', 'assistant:next', 'tool-2'];
  const children = timeline(ids.map(id => [id, id.startsWith('assistant:') ? 'conversation' : 'work']));
  const dom = mountDom({
    rowIds: ['done:turn:0'],
    fetchTimeline: async () => [{ id: fullId('done:turn:0'), kind: 'turn', status: 'completed', children }],
  });
  const turn = attachCompletedTurn(dom, dom.rows[0], ids);
  try {
    await dom.flush();
    assert.equal(turn.button.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(turn.rows.map(row => row.hasAttribute(HIDDEN)), [false, true, false, true]);
    assert.equal(turn.items.querySelectorAll('[data-bb-minus-group]').length, 2);
    assert.deepEqual([...turn.items.querySelectorAll('[data-metrics]')].map(x => x.textContent), ['1 tool · 300ms', '1 tool · 300ms']);
    const metrics = turn.items.querySelector('[data-metrics]');
    assert.equal(metrics.tagName, 'BUTTON');
    metrics.click();
    await dom.flush();
    const marker = metrics.closest('[data-bb-minus-group]');
    assert.ok([...marker.querySelectorAll('[data-toggle]')].every(b => b.getAttribute('aria-expanded') === 'true'));
    assert.equal(turn.rows[1].hasAttribute(HIDDEN), false);
    assert.equal(turn.rows[2].hasAttribute(HIDDEN), false);
    metrics.click();
    await dom.flush();
    assert.equal(turn.rows[1].hasAttribute(HIDDEN), true);
    assert.equal(turn.rows[2].hasAttribute(HIDDEN), false);
  } finally { dom.cleanup(); }
});

test('respects a native turn manually closed by the user through DOM updates and remounting', async () => {
  const dom = mountDom({ rowIds: ['done:turn:0'], fetchTimeline: async () => [{ id: fullId('done:turn:0'), kind: 'turn', children: timeline([['tool-1']]) }] });
  let turn = attachCompletedTurn(dom, dom.rows[0], ['tool-1']);
  try {
    await dom.flush();
    assert.equal(turn.button.getAttribute('aria-expanded'), 'true');
    turn.button.click();
    await dom.flush();
    assert.equal(turn.button.getAttribute('aria-expanded'), 'false');
    dom.container.append(dom.makeRow('assistant:update'));
    await dom.flush();
    assert.equal(turn.button.getAttribute('aria-expanded'), 'false');
    const returning = dom.makeRow('done:turn:0');
    turn = attachCompletedTurn(dom, returning, ['tool-1']);
    dom.rows[0].replaceWith(returning);
    await dom.flush();
    assert.equal(turn.button.getAttribute('aria-expanded'), 'false');
  } finally { dom.cleanup(); }
});

for (const initiallyOpen of [false, true]) {
  test('cleanup restores only native turns auto-opened by Minus; initiallyOpen=' + initiallyOpen, async () => {
    const dom = mountDom({ rowIds: ['done:turn:0'], fetchTimeline: async () => [{ id: fullId('done:turn:0'), kind: 'turn', children: timeline([['tool-1']]) }] });
    const turn = attachCompletedTurn(dom, dom.rows[0], ['tool-1'], initiallyOpen);
    try {
      await dom.flush();
      assert.equal(turn.button.getAttribute('aria-expanded'), 'true');
      dom.dispose();
      assert.equal(turn.button.getAttribute('aria-expanded'), String(initiallyOpen));
      assert.equal(turn.rows[0].hasAttribute(HIDDEN), false);
      assert.equal(turn.items.querySelector('[data-bb-minus-group]'), null);
    } finally { dom.cleanup(); }
  });
}

test('does not open completed turns inside a delegated agent timeline', async () => {
  const dom = mountDom({ rowIds: ['delegation:child'], fetchTimeline: async () => timeline([['delegation:child', 'work', undefined, 1000, null, 'delegation']]) });
  const list = dom.window.document.createElement('div');list.setAttribute('data-timeline-row-list', 'nested');
  const items = dom.window.document.createElement('div');items.setAttribute('data-timeline-items', '');list.append(items);
  const nested = dom.makeRow('child:turn:0');items.append(nested);dom.rows[0].append(list);
  const turn = attachCompletedTurn(dom, nested, ['tool-1']);
  try {
    await dom.flush();
    assert.equal(turn.button.getAttribute('aria-expanded'), 'false');
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
    assert.equal(dom.container.querySelector('[data-bb-minus-group]'), null);
  } finally { dom.cleanup(); }
});

test('a terminal realtime event refreshes final duration without a DOM change or throttle delay', async () => {
  const clock = makeClock(10000);let notify;let fetchCount = 0;let unsubscribed = 0;
  const dom = mountDom({rowIds:['tool-1'],clock,
    subscribeTimeline: callback => { notify = callback;return () => { unsubscribed++; }; },
    fetchTimeline: async () => {fetchCount++;return timeline([['tool-1','work',undefined,10000,fetchCount === 1 ? null : 11500]]);},
  });
  try {
    await dom.flush();
    const metrics = dom.container.querySelector('[data-metrics]');
    assert.equal(metrics.textContent, '1 tool · 0ms');
    clock.advance(1500);
    notify('thr_unrelated', true);
    await dom.flush();assert.equal(fetchCount, 1);
    notify('thr_test', true);
    await dom.flush();
    assert.equal(fetchCount, 2);
    assert.equal(metrics.textContent, '1 tool · 1.5s');
    dom.dispose();assert.equal(unsubscribed, 1);
    notify('thr_test', true);clock.advance(2000);
    await dom.flush();assert.equal(fetchCount, 2);
  } finally { dom.cleanup(); }
  assert.equal(unsubscribed, 1);
});

test('a terminal event during inFlight preserves its forced final refresh', async () => {
  const clock = makeClock(10000);let notify;let finishStale;let fetchCount = 0;
  const dom = mountDom({rowIds:['tool-1'],clock,
    subscribeTimeline: callback => {notify = callback;return () => {};},
    fetchTimeline: () => {
      fetchCount++;
      if (fetchCount === 2) return new Promise(resolve => {finishStale = resolve;});
      return Promise.resolve(timeline([['tool-1','work',undefined,1000,fetchCount === 1 ? 1300 : 2800]]));
    },
  });
  try {
    await dom.flush();assert.equal(fetchCount,1);
    notify('thr_test',true);assert.equal(fetchCount,2);
    notify('thr_test',true);
    finishStale(timeline([['tool-1','work',undefined,1000,1400]]));
    await dom.flush();
    assert.equal(fetchCount,3);
    assert.equal(dom.container.querySelector('[data-metrics]').textContent,'1 tool · 1.8s');
  } finally {dom.cleanup();}
});
