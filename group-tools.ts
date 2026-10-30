// Collapses each run of consecutive tool rows in the top-level thread timeline
// behind one quote toggle styled like bb's "Worked for" row. bb owns the rows (React),
// so this only sets an attribute on them and inserts its own sibling markers.
// The timeline is virtualized, so counts come from the timeline API, not mounted rows.
import { pickRandomQuote, QUOTE_SOURCES, type QuoteEntry } from "./quotes.ts";

type TimelineRow = {
  id: string;
  kind: string;
  workKind?: string;
  startedAt?: number;
  completedAt?: number | null;
  status?: string | null;
};
type FetchTimeline = (threadId: string) => Promise<TimelineRow[]>;
type DisclosureChoice = { revision: number; open: boolean };
type Clock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

const HIDDEN = "data-bb-minus-hidden";
const MARKER = "data-bb-minus-group";
const GROUP_END = "data-bb-minus-group-end";
// Fallback IDs from the SDK's work row kinds. Unknown/streaming rows stay visible.
const TOOL_ROW = /^(command|tool|file-change|web-search|web-fetch|image-generation|image-view|file-read|search|plan-steps|extension):/;
// These work rows carry an agent stream or require the user's response.
const VISIBLE_WORK = new Set(["delegation", "workflow", "approval", "question", "form"]);
const REFETCH_MS = 2000;

const TOGGLE_HTML = `<div class="rounded-md text-subtle-foreground w-full">
  <div data-row class="group/timeline-row min-w-0 px-2 text-sm leading-5">
    <button type="button" aria-expanded="false" class="group/toggle inline max-w-full whitespace-normal break-words px-0 py-0 text-left align-baseline text-sm leading-5 text-subtle-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="mr-1.5 inline-block size-3.5 align-text-bottom text-subtle-foreground opacity-40" aria-hidden="true" data-minus-icon="called-tools"><path d="M12 8.5L3.12132 17.3787C2.72349 17.7765 2.5 18.3161 2.5 18.8787C2.5 20.0503 3.44975 21 4.62132 21C5.18393 21 5.72349 20.7765 6.12132 20.3787L15 11.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M16.1207 5.03693L20.3682 9.3197C21.014 9.97093 21.3369 10.2966 21.4435 10.6774C21.5188 10.9467 21.5188 11.2317 21.4435 11.501C21.3369 11.8819 21.014 12.2075 20.3682 12.8587C19.7223 13.51 19.3994 13.8356 19.0216 13.943C18.7546 14.019 18.4719 14.019 18.2048 13.943C17.8271 13.8356 17.5042 13.51 16.8583 12.8587L10.0245 5.96802C8.99015 4.92507 8.47297 4.40359 8.50109 3.94831C8.51495 3.7239 8.60259 3.51054 8.75017 3.34197C9.04956 3 9.78095 3 11.2437 3C12.4209 3 13.0095 3 13.5574 3.16035C13.8406 3.24325 14.1139 3.3574 14.3723 3.50071C14.8721 3.77792 15.2883 4.19759 16.1207 5.03693Z" stroke="currentColor" stroke-width="1.5"/></svg><span data-quote class="whitespace-normal break-words text-sm italic leading-5 text-subtle-foreground"><span data-quote-start></span><span class="whitespace-nowrap"><span data-quote-end class="inline-block whitespace-normal break-words" style="max-width:calc(100% - 4.5 * var(--spacing))"></span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="bb-icon-stroke pointer-events-none ml-1.5 inline-block size-3 align-text-bottom origin-center text-subtle-foreground transition-[opacity,rotate] duration-200 ease-out opacity-0 group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true"><path d="M6 4l4 4-4 4"></path></svg></span></span>
    </button>
    <a data-source class="mr-1.5 break-words text-xs leading-5 text-subtle-foreground underline underline-offset-2 hover:decoration-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" target="_blank" rel="noopener noreferrer"></a>
    <span data-metrics class="text-xs leading-5 text-subtle-foreground"><span data-count class="whitespace-nowrap"></span> · <span data-time class="whitespace-nowrap"></span></span>
  </div>
</div>`;

function rowKey(row: HTMLElement): string {
  return (row.dataset.timelineRowId ?? "").replace(/^thr_[a-z0-9]+:/, "");
}

function hasAgentContent(row: HTMLElement): boolean {
  return row.querySelector(".group\\/message, [data-timeline-row-list]") !== null;
}

function isToolRow(row: HTMLElement, collapsible?: Map<string, boolean>): boolean {
  // A work/delegation row may contain live messages or an entire child timeline.
  // Hiding its outer wrapper would also hide that useful agent stream.
  if (hasAgentContent(row)) return false;
  const key = rowKey(row);
  if (/^(user|assistant|error|op:)|:turn(:|$)|kind:(assistant|user|reasoning)/.test(key)) return false;
  const known = collapsible?.get(apiId(row));
  if (known !== undefined) return known;
  return TOOL_ROW.test(key) || key.includes(":work-summary:");
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

// Only work rows belong to API runs. Streaming/reasoning rows break the run.
type ThreadRuns = {
  rows: TimelineRow[];
  collapsible: Map<string, boolean>;
  runOf: Map<string, number>;
  counts: number[];
  firstIds: string[];
  memberIds: string[][];
  durationMs: Array<number | null>;
  pending: boolean[];
};
function indexRuns(rows: TimelineRow[], now: number, visibleRows: Set<string>): ThreadRuns {
  const collapsible = new Map(rows.map((row) => [row.id,
    row.kind === "work" && !VISIBLE_WORK.has(row.workKind ?? "") && !visibleRows.has(row.id),
  ]));
  const runOf = new Map<string, number>();
  const counts: number[] = [];
  const firstIds: string[] = [];
  const memberIds: string[][] = [];
  const durationMs: number[] = [];
  const durationKnown: boolean[] = [];
  const pending: boolean[] = [];
  let open = false;
  for (const row of rows) {
    const tool = collapsible.get(row.id);
    if (!tool) {
      open = false;
      continue;
    }
    if (!open) {
      counts.push(0);
      firstIds.push(row.id);
      memberIds.push([]);
      durationMs.push(0);
      durationKnown.push(true);
      pending.push(false);
    }
    open = true;
    runOf.set(row.id, counts.length - 1);
    memberIds[counts.length - 1].push(row.id);
    if (row.kind === "work") {
      const index = counts.length - 1;
      counts[index]++;
      const startedAt = row.startedAt;
      const endedAt = row.completedAt ?? (row.status === "pending" ? now : undefined);
      if (!Number.isFinite(startedAt) || endedAt === undefined) {
        durationKnown[index] = false;
      } else {
        durationMs[index] += Math.max(0, endedAt - startedAt!);
      }
      if (row.status === "pending") pending[index] = true;
    }
  }
  return {
    rows,
    collapsible,
    runOf,
    counts,
    firstIds,
    memberIds,
    durationMs: durationMs.map((duration, index) => durationKnown[index] ? duration : null),
    pending,
  };
}

// The SDK timestamps are milliseconds: 1000ms = 1s, 60s = 1m, and 60m = 1h.
// One decimal in the seconds range keeps short calls compact at 100ms precision.
function formatToolTime(durationMs: number | null): string {
  if (durationMs === null) return "time unavailable";
  if (durationMs < 1000) return Math.round(durationMs) + "ms";
  if (durationMs < 60 * 1000) {
    // Tenths keep the compact tooling row useful for short calls.
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(durationMs / 1000) + "s";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60 * 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + "m" + (seconds === 0 ? "" : " " + seconds + "s");
  }
  const hours = Math.floor(totalSeconds / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  return hours + "h" + (minutes === 0 ? "" : " " + minutes + "m");
}

export function mountToolGrouping(
  fetchTimeline: FetchTimeline,
  chooseQuote: () => QuoteEntry = pickRandomQuote,
  clock: Clock = systemClock,
): () => void {
  const expanded = new Set<string>();
  const groupKeyByRow = new Map<string, string>();
  // Explicit user choices are ordered so a returning row cannot revive an older choice.
  const disclosureChoices = new Map<string, DisclosureChoice>();
  const rowDisclosureChoices = new Map<string, DisclosureChoice>();
  const renderedMembers = new WeakMap<HTMLElement, readonly string[]>();
  let disclosureRevision = 0;
  const quoteByGroup = new Map<string, QuoteEntry>();
  const quoteByRow = new Map<string, QuoteEntry>();
  const threads = new Map<string, ThreadRuns>();
  const visibleRows = new Set<string>();
  const lastFetch = new Map<string, number>();
  const inFlight = new Set<string>();
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const style = document.createElement("style");
  // Keep the native border/inset. The owner's roomier reading rhythm doubles
  // inner padding from 2 to 4 spacing steps; 2 extra steps + native gap 2 = 4
  // steps after the lower divider (and around the open group's end marker).
  style.textContent = `[${HIDDEN}]{display:none!important}
[${MARKER}]{padding-bottom:calc(2 * var(--spacing))}
[${MARKER}] [data-row]{margin-inline:calc(2 * var(--spacing));padding-inline:0;border-top:1px solid var(--border);padding-top:calc(4 * var(--spacing))}
[${MARKER}]:has(button[aria-expanded="false"]) [data-row]{border-bottom:1px solid var(--border);padding-bottom:calc(4 * var(--spacing))}
[${GROUP_END}]{margin-inline:calc(2 * var(--spacing));margin-block:calc(2 * var(--spacing));border-bottom:1px solid var(--border)}`;
  document.head.append(style);

  let frame = 0;
  const schedule = () => {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(pass);
  };

  function refresh(threadId: string) {
    const now = clock.now();
    const last = lastFetch.get(threadId);
    const since = last === undefined ? REFETCH_MS : now - last;
    if (disposed || inFlight.has(threadId)) return;
    if (since < REFETCH_MS) {
      if (!refreshTimers.has(threadId)) {
        const timer = clock.setTimeout(() => {
          refreshTimers.delete(threadId);
          refresh(threadId);
        }, REFETCH_MS - since);
        refreshTimers.set(threadId, timer);
      }
      return;
    }
    const timer = refreshTimers.get(threadId);
    if (timer !== undefined) {
      clock.clearTimeout(timer);
      refreshTimers.delete(threadId);
    }
    inFlight.add(threadId);
    lastFetch.set(threadId, now);
    fetchTimeline(threadId)
      .then(
        (rows) => threads.set(threadId, indexRuns(rows, clock.now(), visibleRows)),
        () => {
          // A failed refresh cannot prove that a spacer does not hide a new run boundary.
          threads.delete(threadId);
        },
      )
      .finally(() => {
        inFlight.delete(threadId);
        schedule();
      });
  }

  function apiRun(rows: HTMLElement[]): {
    key: string;
    count: number;
    durationMs: number | null;
    pending: boolean;
    memberIds: readonly string[];
  } | null {
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
    if (runs.pending[first]) refresh(threadId);
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
      durationMs: unknownRows.length > 0 ? null : runs.durationMs[first],
      pending: runs.pending[first],
      memberIds: runs.memberIds[first],
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
        // The DOM scan may already have split at an unverified spacer. Preserve
        // the API boundary beyond it when deciding where an uncached row belongs.
        if (nextRun === undefined) {
          let next = rows[rows.length - 1].nextElementSibling;
          while (next instanceof HTMLElement) {
            if (next.hasAttribute(MARKER) || next.hasAttribute(GROUP_END) || next.hasAttribute("data-timeline-window-spacer")) {
              next = next.nextElementSibling;
              continue;
            }
            if (!isToolRow(next, api.collapsible)) break;
            nextRun = api.runOf.get(apiId(next));
            if (nextRun !== undefined) break;
            next = next.nextElementSibling;
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
      const choice = { revision: ++disclosureRevision, open: expanded.has(key) };
      disclosureChoices.set(key, choice);
      for (const [id, groupKey] of groupKeyByRow) {
        if (groupKey === key) rowDisclosureChoices.set(id, choice);
      }
      // An API group includes virtualized members too. Remember the explicit
      // choice per member so a returning fallback part cannot revive an older
      // choice, even if the next API refresh fails.
      // Use the membership the user actually saw. A refresh can have already
      // cleared/replaced the API index before the scheduled render runs.
      for (const id of renderedMembers.get(el) ?? []) rowDisclosureChoices.set(id, choice);
      schedule();
    });
    return el;
  }

  function groupEnd(container: Element, key: string): HTMLElement {
    for (const el of container.querySelectorAll<HTMLElement>(`:scope > [${GROUP_END}]`))
      if (el.getAttribute(GROUP_END) === key) return el;
    const el = document.createElement("div");
    el.setAttribute(GROUP_END, key);
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  function hasStableTimelineForSpacer(left: HTMLElement, right: HTMLElement): boolean {
    const threadId = left.dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
    const rightThreadId = right.dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
    if (
      threadId === undefined ||
      threadId !== rightThreadId ||
      inFlight.has(threadId)
    ) return false;
    const runs = threads.get(threadId);
    return (
      runs !== undefined &&
      !runs.pending.some(Boolean) &&
      runs.runOf.has(apiId(left)) &&
      runs.runOf.get(apiId(left)) === runs.runOf.get(apiId(right))
    );
  }

  function pass() {
    frame = 0;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedMarker = focused?.closest<HTMLElement>(`[${MARKER}]`) ?? null;
    const focusedKey = focusedMarker?.getAttribute(MARKER);
    const focusSelector = focused?.matches("button") ? "button" : focused?.matches("[data-source]") ? "[data-source]" : null;
    let migratedFocus: HTMLElement | null = null;
    // Snapshot before rendering so splitting a group can migrate every visible part.
    const previousGroupByRow = new Map(groupKeyByRow);
    const previousChoices = new Map(disclosureChoices);
    const used = new Set<Element>();
    for (const container of document.querySelectorAll("[data-timeline-items]")) {
      if (container.closest("[data-timeline-row-list]")?.getAttribute("data-timeline-row-list") !== "top-level") continue;
      // A streaming work row can acquire message content after the API response.
      // Keep it as a boundary in the API index too, so adjacent tools do not share a marker.
      for (const row of container.children) {
        if (!(row instanceof HTMLElement) || row.dataset.timelineRowId === undefined || !hasAgentContent(row)) continue;
        const id = apiId(row);
        if (visibleRows.has(id)) continue;
        visibleRows.add(id);
        const threadId = row.dataset.timelineRowId.match(/^thr_[a-z0-9]+/)?.[0];
        const api = threads.get(threadId ?? "");
        if (api !== undefined && api.runOf.has(id)) threads.set(threadId!, indexRuns(api.rows, clock.now(), visibleRows));
      }
      // Join across a spacer only when the current API maps both mounted rows to the same run.
      const runs: HTMLElement[][] = [];
      let run: HTMLElement[] = [];
      let spacers: HTMLElement[] = [];
      for (const child of container.children) {
        if (!(child instanceof HTMLElement) || child.hasAttribute(MARKER) || child.hasAttribute(GROUP_END)) continue;
        if (child.hasAttribute("data-timeline-window-spacer") && run.length > 0) {
          spacers.push(child);
          continue;
        }
        const threadId = child.dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
        if (threadId !== undefined && !threads.has(threadId)) refresh(threadId);
        if (child.dataset.timelineRowId !== undefined && isToolRow(child, threads.get(threadId ?? "")?.collapsible)) {
          if (
            run.length > 0 &&
            spacers.length > 0 &&
            !hasStableTimelineForSpacer(run[run.length - 1], child)
          ) {
            runs.push(run);
            run = [];
            for (const spacer of spacers) spacer.removeAttribute(HIDDEN);
            spacers = [];
          }
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

      const parts = runs.flatMap(splitAtApiBoundaries).map(rows => ({ rows, api: apiRun(rows) }));
      const apiParts = new Map<string, number>();
      for (const { api } of parts) {
        if (api !== null) apiParts.set(api.key, (apiParts.get(api.key) ?? 0) + 1);
      }
      for (const { rows, api: candidate } of parts) {
        // A pending/stale API run can span separate visible DOM parts. Give each
        // part its row fallback identity rather than moving one header/end
        // between them on every observer pass. Full-run metrics are ambiguous.
        const api = candidate !== null && apiParts.get(candidate.key) === 1 ? candidate : null;
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
        const previousKeys = mountedIds.flatMap((id) => {
          const previous = previousGroupByRow.get(id);
          return previous === undefined ? [] : [previous];
        });
        const rowChoices = mountedIds.flatMap(id => {
          const choice = rowDisclosureChoices.get(id);
          return choice === undefined ? [] : [choice];
        });
        if (previousKeys.some((previous) => previous !== key) || rowChoices.length > 0) {
          let latestChoice = previousChoices.get(key);
          for (const previous of previousKeys) {
            const choice = previousChoices.get(previous);
            if (choice !== undefined && (latestChoice === undefined || choice.revision > latestChoice.revision)) {
              latestChoice = choice;
            }
          }
          for (const choice of rowChoices) {
            if (latestChoice === undefined || choice.revision > latestChoice.revision) latestChoice = choice;
          }
          if (latestChoice !== undefined) {
            if (latestChoice.open) expanded.add(key);
            else expanded.delete(key);
            disclosureChoices.set(key, latestChoice);
          }
        }
        for (const id of mountedIds) groupKeyByRow.set(id, key);
        const open = expanded.has(key);
        const el = marker(container, key);
        used.add(el);
        renderedMembers.set(el, api?.memberIds ?? mountedIds);
        if (
          migratedFocus === null && focusSelector !== null && focusedKey !== null &&
          focusedKey !== undefined && previousKeys.includes(focusedKey) &&
          focusedMarker?.parentElement === container
        ) migratedFocus = el.querySelector<HTMLElement>(focusSelector);
        const quoteText = el.querySelector<HTMLElement>("[data-quote]")!;
        if (quoteText.textContent !== quote.text) {
          // Keep the chevron with the last word: an invisible arrow on its own
          // line otherwise adds an empty line before the author/source. The last
          // word may wrap within button width - (icon 3 + margin 1.5) spacing
          // units, so its attached chevron also fits at enlarged text sizes.
          const tailStart = quote.text.search(/\S+\s*$/);
          el.querySelector("[data-quote-start]")!.textContent = quote.text.slice(0, tailStart);
          el.querySelector("[data-quote-end]")!.textContent = quote.text.slice(tailStart);
        }
        if (quoteText.title !== quote.text) quoteText.title = quote.text;
        const quoteId = "bb-minus-quote-" + encodeURIComponent(key);
        if (quoteText.id !== quoteId) quoteText.id = quoteId;
        const source = QUOTE_SOURCES[quote.source];
        const sourceLocator = quote.locator.replace(
          /^Project Gutenberg plain-text line (\d+)$/,
          "Строка $1 в тексте Project Gutenberg",
        );
        const sourceLink = el.querySelector<HTMLAnchorElement>("[data-source]")!;
        if (sourceLink.textContent !== source.byline) sourceLink.textContent = source.byline;
        if (sourceLink.href !== source.url) sourceLink.href = source.url;
        sourceLink.setAttribute(
          "aria-label",
          source.credit + ". «" + source.title + "». " + sourceLocator + ". Русский перевод Minus. Открыть источник.",
        );
        sourceLink.title = source.credit + ". «" + source.title + "». " + sourceLocator + ". Русский перевод Minus.";
        const duration = formatToolTime(api?.durationMs ?? null);
        const metrics = el.querySelector<HTMLElement>("[data-metrics]")!;
        const visibleCount = calls + " tool" + (calls === 1 ? "" : "s");
        if (metrics.textContent !== visibleCount + " · " + duration) {
          // Let count and time wrap independently at narrow widths/text zoom,
          // keeping each value with its unit rather than overflowing the inset.
          metrics.querySelector("[data-count]")!.textContent = visibleCount;
          metrics.querySelector("[data-time]")!.textContent = duration;
        }
        metrics.title = "Total time across individual tool calls; parallel calls are added together.";
        const accessibleLabel =
          (open ? "Hide " : "Show ") +
          calls +
          " tool call" +
          (calls === 1 ? "" : "s") +
          ". Total tool time: " +
          duration +
          ".";
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
        if (open) {
          const end = groupEnd(container, key);
          used.add(end);
          const last = rows[rows.length - 1];
          if (end.previousElementSibling !== last) container.insertBefore(end, last.nextSibling);
        }
      }
    }
    for (const el of document.querySelectorAll(`[${MARKER}], [${GROUP_END}]`)) if (!used.has(el)) el.remove();
    // Replacing a fallback header with an API header must preserve keyboard
    // focus, so the next Enter/Space still acts on the same visible group.
    if (focusedMarker !== null && document.activeElement !== focused) {
      if (used.has(focusedMarker)) focused?.focus({ preventScroll: true });
      else migratedFocus?.focus({ preventScroll: true });
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  pass();

  return () => {
    disposed = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const timer of refreshTimers.values()) clock.clearTimeout(timer);
    refreshTimers.clear();
    style.remove();
    for (const el of document.querySelectorAll(`[${MARKER}], [${GROUP_END}]`)) el.remove();
    for (const el of document.querySelectorAll(`[${HIDDEN}]`)) el.removeAttribute(HIDDEN);
    quoteByGroup.clear();
    quoteByRow.clear();
    expanded.clear();
    groupKeyByRow.clear();
    disclosureChoices.clear();
    rowDisclosureChoices.clear();
    visibleRows.clear();
  };
}
