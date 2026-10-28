// Collapses each run of consecutive tool/thinking rows in the top-level thread timeline
// behind one quote toggle styled like bb's "Worked for" row. bb owns the rows (React),
// so this only sets an attribute on them and inserts its own sibling markers.
// The timeline is virtualized, so counts come from the timeline API, not mounted rows.
import { pickRandomQuote, QUOTE_SOURCES, type QuoteEntry } from "./quotes.ts";

type TimelineRow = { id: string; kind: string };
type FetchTimeline = (threadId: string) => Promise<TimelineRow[]>;

const HIDDEN = "data-bb-minus-hidden";
const MARKER = "data-bb-minus-group";
const NON_TOOL = /^(user|assistant|error|op:(?!reasoning:))|:turn(:|$)|kind:(assistant|user)/;
const REFETCH_MS = 2000;

const TOGGLE_HTML = `<div class="rounded-md text-muted-foreground w-full">
  <div class="group/timeline-row flex min-w-0 items-center gap-1.5">
    <button type="button" aria-expanded="false" class="items-center gap-1 overflow-hidden text-left text-sm text-muted-foreground transition-colors duration-150 hover:duration-0 hover:text-foreground focus-visible:text-foreground group/toggle cursor-pointer px-2 flex min-w-0 flex-1 max-w-full justify-start py-0 leading-5">
      <span class="min-w-0 max-w-full">
        <span class="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="size-3.5 shrink-0 text-muted-foreground opacity-40" aria-hidden="true"><path d="M12 8.5L3.12132 17.3787C2.72349 17.7765 2.5 18.3161 2.5 18.8787C2.5 20.0503 3.44975 21 4.62132 21C5.18393 21 5.72349 20.7765 6.12132 20.3787L15 11.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M16.1207 5.03693L20.3682 9.3197C21.014 9.97093 21.3369 10.2966 21.4435 10.6774C21.5188 10.9467 21.5188 11.2317 21.4435 11.501C21.3369 11.8819 21.014 12.2075 20.3682 12.8587C19.7223 13.51 19.3994 13.8356 19.0216 13.943C18.7546 14.019 18.4719 14.019 18.2048 13.943C17.8271 13.8356 17.5042 13.51 16.8583 12.8587L10.0245 5.96802C8.99015 4.92507 8.47297 4.40359 8.50109 3.94831C8.51495 3.7239 8.60259 3.51054 8.75017 3.34197C9.04956 3 9.78095 3 11.2437 3C12.4209 3 13.0095 3 13.5574 3.16035C13.8406 3.24325 14.1139 3.3574 14.3723 3.50071C14.8721 3.77792 15.2883 4.19759 16.1207 5.03693Z" stroke="currentColor" stroke-width="1.5"/></svg>
          <span data-quote class="min-w-0 max-w-full truncate text-sm italic leading-5 text-muted-foreground"></span>
        </span>
      </span>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="bb-icon-stroke pointer-events-none size-3 shrink-0 origin-center text-subtle-foreground/60 transition-[opacity,rotate] duration-200 ease-out opacity-0 group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true"><path d="M6 4l4 4-4 4"></path></svg>
    </button>
    <a data-source class="shrink-0 whitespace-nowrap text-sm leading-5 text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" target="_blank" rel="noopener noreferrer"></a>
  </div>
</div>`;

function rowKey(row: HTMLElement): string {
  return (row.dataset.timelineRowId ?? "").replace(/^thr_[a-z0-9]+:/, "");
}

function isToolRow(row: HTMLElement): boolean {
  return !NON_TOOL.test(rowKey(row)) && row.querySelector(".group\\/message") === null;
}

// A work summary's DOM id ends with the id of the first API row it covers.
function apiId(row: HTMLElement): string {
  const id = row.dataset.timelineRowId ?? "";
  return id.split(":work-summary:")[1] ?? id;
}

// Fallback while the API answer is pending: "Ran 4 commands, explored 2 searches 1 error".
function domCount(row: HTMLElement): number {
  const key = rowKey(row);
  if (!key.includes("work-summary")) return key.includes("reasoning") ? 0 : 1;
  let n = 0;
  for (const m of (row.querySelector("button")?.textContent ?? "").matchAll(/(\d+)\s+(\w+)/g))
    if (!m[2].startsWith("error")) n += Number(m[1]);
  return n || 1;
}

// API runs: consecutive work rows and reasoning rows; anything else breaks a run.
type ThreadRuns = { runOf: Map<string, number>; counts: number[]; firstIds: string[] };
function indexRuns(rows: TimelineRow[]): ThreadRuns {
  const runOf = new Map<string, number>();
  const counts: number[] = [];
  const firstIds: string[] = [];
  let open = false;
  for (const row of rows) {
    const tool = row.kind === "work" || (row.kind === "system" && row.id.includes(":op:reasoning:"));
    if (!tool) {
      open = false;
      continue;
    }
    if (!open) {
      counts.push(0);
      firstIds.push(row.id);
    }
    open = true;
    runOf.set(row.id, counts.length - 1);
    if (row.kind === "work") counts[counts.length - 1]++;
  }
  return { runOf, counts, firstIds };
}

export function mountToolGrouping(
  fetchTimeline: FetchTimeline,
  chooseQuote: () => QuoteEntry = pickRandomQuote,
): () => void {
  const expanded = new Set<string>();
  const expandedSplitTransitions = new Set<string>();
  const quoteByGroup = new Map<string, QuoteEntry>();
  const quoteByRow = new Map<string, QuoteEntry>();
  const threads = new Map<string, ThreadRuns>();
  const lastFetch = new Map<string, number>();
  const inFlight = new Set<string>();
  let disposed = false;
  const style = document.createElement("style");
  style.textContent = `[${HIDDEN}]{display:none!important}`;
  document.head.append(style);

  let frame = 0;
  const schedule = () => {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(pass);
  };

  function refresh(threadId: string) {
    const since = Date.now() - (lastFetch.get(threadId) ?? 0);
    if (disposed || inFlight.has(threadId)) return;
    if (since < REFETCH_MS) {
      setTimeout(() => refresh(threadId), REFETCH_MS - since);
      return;
    }
    inFlight.add(threadId);
    lastFetch.set(threadId, Date.now());
    fetchTimeline(threadId)
      .then((rows) => threads.set(threadId, indexRuns(rows)), () => {})
      .finally(() => {
        inFlight.delete(threadId);
        schedule();
      });
  }

  function apiRun(rows: HTMLElement[]): { key: string; count: number } | null {
    const threadId = rows[0].dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
    if (threadId === undefined) return null;
    const runs = threads.get(threadId);
    if (runs === undefined) {
      refresh(threadId);
      return null;
    }
    const ids = rows.filter((row) => row.dataset.timelineRowId !== undefined).map(apiId);
    const knownIds = ids.filter((id) => runs.runOf.has(id));
    if (knownIds.length === 0) {
      refresh(threadId);
      return null;
    }
    const first = runs.runOf.get(knownIds[0]);
    if (first === undefined || knownIds.some((id) => runs.runOf.get(id) !== first)) return null;
    const firstRowId = runs.firstIds[first];
    if (firstRowId === undefined) return null;
    const unknownRows = rows.filter(
      (row) => row.dataset.timelineRowId !== undefined && !runs.runOf.has(apiId(row)),
    );
    if (unknownRows.length > 0) refresh(threadId);
    const unknownCount = unknownRows.reduce((sum, row) => sum + domCount(row), 0);
    return {
      key: "timeline:" + threadId + ":" + firstRowId,
      count: runs.counts[first] + unknownCount,
    };
  }

  // A virtualization spacer can cover a system row that separates two API runs.
  // Split the mounted DOM run at that boundary and leave its spacer outside either group.
  function splitAtApiBoundaries(rows: HTMLElement[]): HTMLElement[][] {
    const threadId = rows[0].dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
    if (threadId === undefined) return [rows];
    const api = threads.get(threadId);
    if (api === undefined) return [rows];

    const groups: HTMLElement[][] = [];
    let group: HTMLElement[] = [];
    let pendingSpacers: HTMLElement[] = [];
    let openRun: number | undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.hasAttribute("data-timeline-window-spacer")) {
        pendingSpacers.push(row);
        continue;
      }
      const id = row.dataset.timelineRowId;
      const run = id === undefined ? undefined : api.runOf.get(apiId(row));
      if (run === undefined) {
        let nextRun: number | undefined;
        for (let next = i + 1; next < rows.length; next++) {
          const candidate = rows[next];
          if (candidate.hasAttribute("data-timeline-window-spacer")) continue;
          const candidateId = candidate.dataset.timelineRowId;
          const candidateRun =
            candidateId === undefined ? undefined : api.runOf.get(apiId(candidate));
          if (candidateRun !== undefined) {
            nextRun = candidateRun;
            break;
          }
        }
        if (openRun !== undefined && nextRun !== undefined && nextRun !== openRun) {
          for (const spacer of pendingSpacers) spacer.removeAttribute(HIDDEN);
          pendingSpacers = [];
          if (group.length > 0) groups.push(group);
          group = [];
          row.removeAttribute(HIDDEN);
          groups.push([row]);
        } else {
          group.push(...pendingSpacers, row);
          pendingSpacers = [];
        }
        continue;
      }
      if (openRun !== undefined && run !== openRun) {
        for (const spacer of pendingSpacers) spacer.removeAttribute(HIDDEN);
        pendingSpacers = [];
        if (group.length > 0) groups.push(group);
        group = [row];
      } else {
        group.push(...pendingSpacers, row);
        pendingSpacers = [];
      }
      openRun = run;
    }
    if (group.length > 0) groups.push(group);
    for (const spacer of pendingSpacers) spacer.removeAttribute(HIDDEN);

    if (groups.length > 1) {
      const firstRow = rows.find((row) => row.dataset.timelineRowId !== undefined);
      if (firstRow !== undefined) {
        const fallbackKey = `row:${threadId}:${rowKey(firstRow)}`;
        // Only migrate an expansion that predates the API mapping. A mounted API group
        // being open must not expand a newly visible neighbor after virtualization shifts.
        const wasExpanded = expanded.has(fallbackKey);
        const groupKeys = groups.map((part) => {
          const groupFirstRow = part.find((row) => row.dataset.timelineRowId !== undefined)!;
          const run = api.runOf.get(apiId(groupFirstRow));
          const groupFirstId = run === undefined ? undefined : api.firstIds[run];
          return groupFirstId === undefined
            ? `row:${threadId}:${rowKey(groupFirstRow)}`
            : `timeline:${threadId}:${groupFirstId}`;
        });
        const apiGroupKeys = groups.flatMap((part) => {
          const mappedRow = part.find((row) => {
            const id = row.dataset.timelineRowId;
            return id !== undefined && api.runOf.has(apiId(row));
          });
          if (mappedRow === undefined) return [];
          const run = api.runOf.get(apiId(mappedRow));
          const firstId = run === undefined ? undefined : api.firstIds[run];
          return firstId === undefined ? [] : [`timeline:${threadId}:${firstId}`];
        });
        const transition = threadId + "\0" + [...new Set(apiGroupKeys)].join("\0");
        if (!expandedSplitTransitions.has(transition)) {
          expandedSplitTransitions.add(transition);
          if (wasExpanded) for (const key of groupKeys) expanded.add(key);
        }
      }
    }
    return groups.length > 0 ? groups : [rows];
  }

  function marker(container: Element, key: string): HTMLElement {
    for (const el of container.querySelectorAll<HTMLElement>(`:scope > [${MARKER}]`))
      if (el.getAttribute(MARKER) === key) return el;
    const el = document.createElement("div");
    el.setAttribute(MARKER, key);
    el.innerHTML = TOGGLE_HTML;
    el.querySelector("button")!.addEventListener("click", () => {
      if (!expanded.delete(key)) expanded.add(key);
      schedule();
    });
    return el;
  }

  function pass() {
    frame = 0;
    const used = new Set<Element>();
    for (const container of document.querySelectorAll("[data-timeline-items]")) {
      if (container.closest("[data-timeline-row-list]")?.getAttribute("data-timeline-row-list") !== "top-level") continue;
      // Virtualization spacers inside a run stand for unmounted tool rows: they join the run.
      const runs: HTMLElement[][] = [];
      let run: HTMLElement[] = [];
      let spacers: HTMLElement[] = [];
      for (const child of container.children) {
        if (!(child instanceof HTMLElement) || child.hasAttribute(MARKER)) continue;
        if (child.hasAttribute("data-timeline-window-spacer") && run.length > 0) {
          spacers.push(child);
          continue;
        }
        if (child.dataset.timelineRowId !== undefined && isToolRow(child)) {
          run.push(...spacers, child);
          spacers = [];
          continue;
        }
        if (run.length > 0) runs.push(run);
        for (const el of [...spacers, child]) el.removeAttribute(HIDDEN);
        run = [];
        spacers = [];
      }
      if (run.length > 0) runs.push(run);
      for (const el of spacers) el.removeAttribute(HIDDEN);

      for (const rows of runs.flatMap(splitAtApiBoundaries)) {
        const api = apiRun(rows);
        const calls =
          api?.count ??
          rows.reduce((sum, row) => sum + (row.dataset.timelineRowId === undefined ? 0 : domCount(row)), 0);
        if (calls === 0) {
          for (const row of rows) row.removeAttribute(HIDDEN);
          continue;
        }
        const threadId = rows[0].dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0] ?? "unknown";
        const fallbackKey = `row:${threadId}:${rowKey(rows[0])}`;
        const key = api?.key ?? fallbackKey;
        const mountedIds = rows
          .filter((row) => row.dataset.timelineRowId !== undefined)
          .map(apiId);
        const quote =
          quoteByGroup.get(key) ??
          quoteByGroup.get(fallbackKey) ??
          mountedIds.map((id) => quoteByRow.get(id)).find((entry) => entry !== undefined) ??
          chooseQuote();
        quoteByGroup.set(key, quote);
        quoteByGroup.set(fallbackKey, quote);
        for (const id of mountedIds) quoteByRow.set(id, quote);
        if (api !== null && expanded.delete(fallbackKey)) expanded.add(key);
        const open = expanded.has(key);
        const el = marker(container, key);
        used.add(el);
        const quoteText = el.querySelector<HTMLElement>("[data-quote]")!;
        if (quoteText.textContent !== quote.text) quoteText.textContent = quote.text;
        const quoteId = "bb-minus-quote-" + encodeURIComponent(key);
        if (quoteText.id !== quoteId) quoteText.id = quoteId;
        const source = QUOTE_SOURCES[quote.source];
        const sourceLink = el.querySelector<HTMLAnchorElement>("[data-source]")!;
        if (sourceLink.textContent !== source.byline) sourceLink.textContent = source.byline;
        if (sourceLink.href !== source.url) sourceLink.href = source.url;
        sourceLink.setAttribute(
          "aria-label",
          source.credit + ". " + source.title + ". " + quote.locator + ". Russian translation by Minus. Open the source.",
        );
        sourceLink.title = source.credit + ". " + source.title + " — " + quote.locator + ". Russian translation by Minus.";
        const accessibleLabel = (open ? "Hide" : "Show") + " " + calls + " tool call" + (calls === 1 ? "" : "s");
        const button = el.querySelector<HTMLButtonElement>("button")!;
        button.setAttribute("aria-label", accessibleLabel);
        button.setAttribute("aria-describedby", quoteId);
        button.setAttribute("aria-expanded", String(open));
        el.querySelector<SVGElement>("svg.bb-icon-stroke")!.style.rotate = open ? "90deg" : "";
        if (el.nextElementSibling !== rows[0]) container.insertBefore(el, rows[0]);
        for (const row of rows) {
          if (open) row.removeAttribute(HIDDEN);
          else if (!row.hasAttribute(HIDDEN)) row.setAttribute(HIDDEN, "");
        }
      }
    }
    for (const el of document.querySelectorAll(`[${MARKER}]`)) if (!used.has(el)) el.remove();
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  pass();

  return () => {
    disposed = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    style.remove();
    for (const el of document.querySelectorAll(`[${MARKER}]`)) el.remove();
    for (const el of document.querySelectorAll(`[${HIDDEN}]`)) el.removeAttribute(HIDDEN);
    quoteByGroup.clear();
    quoteByRow.clear();
    expanded.clear();
    expandedSplitTransitions.clear();
  };
}
