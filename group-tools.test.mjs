import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { mountToolGrouping } from "./group-tools.ts";
import { QUOTE_SOURCES, QUOTES, pickRandomQuote } from "./quotes.ts";

const HIDDEN = "data-bb-minus-hidden";

function makeRow(window, id) {
  const row = window.document.createElement("div");
  row.setAttribute("data-timeline-row-id", id.startsWith("thr_") ? id : "thr_test:" + id);
  return row;
}

function mountDom({ rowIds, fetchTimeline, chooseQuote = () => QUOTES[0] }) {
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
  const dispose = mountToolGrouping(fetchTimeline, chooseQuote);

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
  return rows.map(([id, kind = "work", operationKind]) => ({
    id: "thr_test:" + id,
    kind,
    ...(operationKind === undefined ? {} : { operationKind }),
  }));
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
      assert.equal(marker.textContent.includes("Called"), false);
      assert.equal(button.getAttribute("aria-label"), "Show " + count + " tool call" + (count === 1 ? "" : "s"));
      assert.equal(button.getAttribute("aria-describedby"), quote.id);
      assert.equal(quote.textContent, QUOTES[0].text);
      assert.ok(quote.classList.contains("italic"));
      assert.ok(quote.classList.contains("truncate"));
      assert.equal(source.textContent, QUOTE_SOURCES[QUOTES[0].source].byline);
      assert.equal(source.href, QUOTE_SOURCES[QUOTES[0].source].url);
      assert.equal(source.target, "_blank");
      assert.equal(source.rel, "noopener noreferrer");
      assert.equal(button.contains(source), false);
      source.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
      await dom.flush();
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.ok(source.getAttribute("aria-label").includes("Russian translation by Minus"));
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
    assert.equal(marker.querySelector("button").getAttribute("aria-label"), "Show 3 tool calls");
    assert.equal(marker.textContent.includes("Called"), false);
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
    marker.querySelector("button").click();
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
  } finally {
    dom.cleanup();
  }
});

test("keeps a manual stop visible and outside collapsed tool-call groups", async () => {
  const rowIds = ["tool-1", "op:thread-interrupted:manual-stop", "tool-2"];
  const dom = mountDom({
    rowIds,
    fetchTimeline: async () => timeline([
      ["tool-1"],
      ["op:thread-interrupted:manual-stop", "system", "thread-interrupted"],
      ["tool-2"],
    ]),
  });
  const stopRow = dom.rows[1];
  stopRow.textContent = "Stopped manually";
  try {
    const assertGroupsAndStop = () => {
      const markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
      assert.equal(markers.length, 2);
      assert.deepEqual(
        markers.map((marker) => marker.querySelector("button").getAttribute("aria-label")),
        ["Show 1 tool call", "Show 1 tool call"],
      );
      assert.equal(stopRow.textContent, "Stopped manually");
      assert.equal(stopRow.hasAttribute(HIDDEN), false);
    };

    assertGroupsAndStop(); // DOM fallback before the timeline API resolves.
    await dom.flush();
    assertGroupsAndStop(); // API-backed grouping keeps the system row as a boundary.

    const buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] button")];
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
    let markers = [...dom.container.querySelectorAll("[data-bb-minus-group]")];
    assert.equal(markers.length, 1);
    assert.equal(markers[0].querySelector("button").getAttribute("aria-label"), "Show 2 tool calls");

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
      ["Show 1 tool call", "Show 1 tool call"],
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
    dom.container.querySelector("[data-bb-minus-group] button").click();
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
      ["Show 1 tool call", "Show 1 tool call", "Show 1 tool call"],
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
    assert.equal(markers[0].querySelector("button").getAttribute("aria-label"), "Show 3 tool calls");
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
    dom.container.querySelector("[data-bb-minus-group] button").click();
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
      [...dom.container.querySelectorAll("[data-bb-minus-group] button")].map((button) => button.getAttribute("aria-expanded")),
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
    let buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] button")];
    assert.equal(buttons.length, 2);
    buttons[1].click();
    await dom.flush();
    assert.deepEqual(buttons.map((button) => button.getAttribute("aria-expanded")), ["false", "true"]);

    dom.rows[0].remove();
    const newlyVisible = dom.makeRow("tool-3");
    dom.container.append(newlyVisible);
    await dom.flush();

    buttons = [...dom.container.querySelectorAll("[data-bb-minus-group] button")];
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
    dom.rows[0].remove();
    dom.container.append(dom.makeRow("tool-2"));
    await dom.flush();
    const after = dom.container.querySelector("[data-quote]").textContent;
    assert.equal(after, before);
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

test("dispose restores rows and removes injected DOM", async () => {
  const dom = mountDom({
    rowIds: ["tool-1"],
    fetchTimeline: async () => timeline([["tool-1"]]),
  });
  try {
    await dom.flush();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), true);
    assert.ok(dom.window.document.head.querySelector("style"));
    dom.dispose();
    assert.equal(dom.rows[0].hasAttribute(HIDDEN), false);
    assert.equal(dom.container.querySelector("[data-bb-minus-group]"), null);
    assert.equal(dom.window.document.head.querySelector("style"), null);
  } finally {
    dom.cleanup();
  }
});

test("all quotes have unique excerpts and a source with a line locator", () => {
  const ids = QUOTES.map((quote) => quote.id);
  const originals = QUOTES.map((quote) => quote.original);
  assert.equal(QUOTES.length, 200);
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
    ["dhammapada-46a81bbbd230", "Если мысли неустойчивы, если он не знает истинного закона и если душевный покой смят, знание не станет совершенным."],
    ["dhammapada-9a0c48f9874c", "Если человек говорит или поступает с чистой мыслью, за ним следует счастье — как неотступная тень."],
    ["dhammapada-92faf9189c0a", "Дар учения превыше всех даров, сладость учения — превыше всех сладостей, радость учения — превыше всякой радости; угасание жажды побеждает всякую боль."],
    ["dhammapada-94c77097ee24", "Если мысли не мечутся, ум не смят и человек перестал думать о добре и зле, бдительный не знает страха."],
    ["dhammapada-afd378accc60", "Кто принимает ложное за истину и видит ложное в истинном, не придёт к истине и последует пустым желаниям."],
    ["tao-d4268b53c2ad", "Пусть простая пища будет сладкой, скромная одежда — красивой, бедное жилище — местом покоя, а простые привычки — источником радости."],
    ["tao-e3df4627ff89", "Без желаний и в тишине всё идёт своим естественным ходом."],
    ["selfhelp-b2c75abcf579", "Такие реформы возможны лишь через личные поступки, бережливость и самоограничение — через улучшение привычек, а не расширение прав."],
    ["selfhelp-e14ffcf3a546", "Утраченное богатство можно вернуть трудом, знания — учёбой, здоровье — умеренностью или лекарствами, но потерянное время не вернуть."],
    ["dhammapada-9a3245e437a7", "Кто не ищет удовольствий, хорошо владеет чувствами, умерен в еде, верен и силён, того Мара не одолеет, как ветер не свалит каменную гору."],
    ["tao-6a1f44d8b101", "Все искусства продления жизни оборачиваются злом: когда ум разжигает жизненное дыхание, сила становится ложной, и о ней стоит скорбеть."],
    ["tao-9ad487ee4424", "Когда перестали следовать Великому Пути, вошли в моду человеколюбие и справедливость; затем явились мудрость с хитростью — и пришло великое лицемерие."],
    ["meditations-8de4cd77e490", "Его единственным делом было идти прямо туда, куда вели справедливость и разум, и тем самым следовать Богу."],
    ["walden-ecba9fc71933", "Если тебя всё же вовлекут в благотворительное дело, пусть левая рука не знает, что делает правая: знать это не стоит."],
    ["walden-27feeef1b197", "Если человек свободен от мысли, фантазии и воображения, а несуществующее не может долго казаться ему существующим, неразумные правители и реформаторы не смогут сломить его."],
    ["emerson-0473df4621da", "Возвысившись над страстями, душа видит тождество и вечную причинность, созерцает самостоятельное бытие Истины и Права и находит покой в знании, что всё идёт хорошо."],
    ["selfhelp-63df51d1c93a", "Самодисциплина и самообладание — начало практической мудрости; их корень — уважение к себе."],
  ]);

  for (const [id, text] of reviewed) {
    assert.equal(QUOTES.find((quote) => quote.id === id)?.text, text, id);
  }
});
