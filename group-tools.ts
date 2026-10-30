// Collapses each run of consecutive tool rows in the top-level thread timeline
// behind one quote toggle styled like bb's "Worked for" row. bb owns the rows (React),
// so this only sets an attribute on them and inserts its own sibling markers.
// The timeline is virtualized, so counts come from the timeline API, not mounted rows.
import { pickRandomQuote, QUOTE_SOURCES, type QuoteEntry } from "./quotes.ts";

type TimelineRow = {
  id: string;
  kind: string;
  operationKind?: string;
  workKind?: string;
  startedAt?: number;
  completedAt?: number | null;
  status?: string | null;
  children?: TimelineRow[] | null;
};
type FetchTimeline = (threadId: string) => Promise<TimelineRow[]>;
type SubscribeTimeline = (notify: (threadId: string | undefined, finished: boolean) => void) => () => void;
type DisclosureChoice = { revision: number; open: boolean };
type ToolActivity = "pending" | "completed" | "error" | "cancelled" | "unknown";
const ACTIVITY_LABELS: Record<ToolActivity, string> = {
  pending: "Выполняется", completed: "Завершено", error: "Завершено с ошибкой",
  cancelled: "Остановлено", unknown: "Статус выполнения уточняется",
};
// Native-sized, currentColor SVG geometry; the spinner uses BB's animate-spin token.
const ACTIVITY_ICONS: Record<ToolActivity, string> = {
  pending: '<path d="M12 2a10 10 0 1 0 10 10"/>',
  completed: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/>',
  cancelled: '<circle cx="12" cy="12" r="10"/><path d="m8 8 8 8m0-8-8 8"/>',
  unknown: '<circle cx="12" cy="12" r="10" stroke-dasharray="2 3"/>',
};
function toolActivity(row: TimelineRow): ToolActivity {
  if (row.status === "pending" || row.status === "completed" || row.status === "error" || row.status === "cancelled") return row.status;
  return "unknown";
}
function combinedActivity(states: ToolActivity[]): ToolActivity {
  return (["pending", "error", "cancelled", "unknown"] as const).find(state => states.includes(state)) ??
    (states.length > 0 ? "completed" : "unknown");
}
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
const FLAT_TURN = "data-bb-minus-stream-turn";
const FLAT_SUMMARY = "data-bb-minus-stream-summary";
const TURN_SHELL = "data-bb-minus-turn-shell";
const STREAM_FOCUS = "data-bb-minus-stream-focus";
// Fallback IDs from the SDK's work row kinds. Unknown/streaming rows stay visible.
const TOOL_ROW = /^(command|tool|file-change|web-search|web-fetch|image-generation|image-view|file-read|search|plan-steps|extension):/;
// These work rows carry an agent stream or require the user's response.
const VISIBLE_WORK = new Set(["delegation", "workflow", "approval", "question", "form"]);
const VISIBLE_WORK_ROW = /^(delegation|workflow|approval|question|form):/;
// Keep the existing active-stream cadence; terminal realtime events bypass it.
const REFETCH_MS = 2000;

const TOGGLE_HTML = `<div class="rounded-md text-subtle-foreground w-full">
  <div data-row class="group/timeline-row min-w-0 px-2 text-sm leading-5">
    <button data-toggle="quote" type="button" aria-expanded="false" class="inline px-0 py-0 align-baseline text-sm leading-5 text-subtle-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 inline-block size-3.5 align-text-bottom text-subtle-foreground" aria-hidden="true" data-minus-icon="activity"></svg><span data-activity-label class="sr-only"></span></button><label data-quote-control class="group/toggle inline whitespace-normal break-words cursor-pointer"><span data-quote class="whitespace-normal break-words text-sm italic leading-5 text-subtle-foreground"><span data-quote-start></span><span class="whitespace-nowrap"><span data-quote-end class="inline-block whitespace-normal break-words" style="max-width:calc(100% - 4.5 * var(--spacing))"></span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="bb-icon-stroke pointer-events-none ml-1.5 inline-block size-3 align-text-bottom origin-center text-subtle-foreground transition-[opacity,rotate] duration-200 ease-out opacity-0 group-hover/toggle:opacity-100 group-focus-within/timeline-row:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true"><path d="M6 4l4 4-4 4"></path></svg></span></span> — <span data-source class="mr-1.5 break-words text-xs not-italic leading-5 text-subtle-foreground"></span></label>
    <button data-metrics data-toggle="metrics" type="button" aria-expanded="false" class="inline max-w-full whitespace-normal break-words px-0 py-0 text-left align-baseline text-xs leading-5 text-subtle-foreground underline underline-offset-2 hover:decoration-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"><span data-count class="whitespace-nowrap"></span><span data-time-separator> · </span><span data-time class="whitespace-nowrap"></span></button>
  </div>
</div>`;

function rowKey(row: HTMLElement): string {
  return (row.dataset.timelineRowId ?? "").replace(/^thr_[a-z0-9]+:/, "");
}

function hasAgentContent(row: HTMLElement): boolean {
  // Native running work summaries use a "bundle" list of tool rows. Its
  // presence alone is not an agent stream; actual messages still stay visible.
  return row.querySelector('.group\\/message, [data-timeline-row-list]:not([data-timeline-row-list="bundle"])') !== null;
}

function summaryHasAgentWork(row: HTMLElement): boolean {
  return rowKey(row).includes(":work-summary:") &&
    /\d+\s+(subagents?|workflows?)/i.test(turnButton(row)?.textContent ?? "");
}

function isTopLevelTurn(row: HTMLElement): boolean {
  return /:turn(:|$)/.test(rowKey(row)) &&
    row.closest("[data-timeline-row-list]")?.getAttribute("data-timeline-row-list") === "top-level";
}

function turnButton(row: HTMLElement): HTMLButtonElement | null {
  return row.querySelector<HTMLButtonElement>(':scope > div > [class~="group/timeline-row"] > button');
}

function isToolContainer(container: Element): boolean {
  const list = container.closest("[data-timeline-row-list]");
  if (list?.getAttribute("data-timeline-row-list") === "top-level") return true;
  // Completed turns use a nested list too. Delegated agent timelines stay native.
  const owner = list?.closest<HTMLElement>("[data-timeline-row-id]");
  return owner !== null && owner !== undefined && (isTopLevelTurn(owner) ||
    (list?.getAttribute("data-timeline-row-list") === "bundle" && owner.hasAttribute(FLAT_SUMMARY)));
}

function isToolRow(row: HTMLElement, runs?: ThreadRuns, visibleRows?: ReadonlySet<string>): boolean {
  // A work/delegation row may contain live messages or an entire child timeline.
  // Hiding its outer wrapper would also hide that useful agent stream.
  if (hasAgentContent(row) || summaryHasAgentWork(row) ||
    visibleRows?.has(row.dataset.timelineRowId ?? "") || visibleRows?.has(apiId(row))) return false;
  const members = summaryMembers(row, runs);
  if (members !== undefined) return members.every(member =>
    !VISIBLE_WORK.has(member.workKind ?? "") && runs?.collapsible.get(member.id) !== false);
  const key = rowKey(row);
  if (VISIBLE_WORK_ROW.test(key)) return false;
  if (/^(user|assistant|error|op:)|:turn(:|$)|kind:(assistant|user|reasoning)/.test(key)) return false;
  const known = runs?.collapsible.get(apiId(row));
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
  sourceOf: Map<string, { source: TimelineRow[]; index: number }>;
  collapsible: Map<string, boolean>;
  runOf: Map<string, number>;
  counts: number[];
  firstIds: string[];
  memberIds: string[][];
  durationMs: Array<number | null>;
  pending: boolean[];
  activity: ToolActivity[];
};

// Native work summaries can span reasoning boundaries and therefore several
// API runs. Recover their complete membership from their own header count,
// bounded by the API sibling list and conversation/interaction boundaries.
// Never turn an incomplete API window into a partial, apparently exact total.
function summaryMembers(row: HTMLElement, runs?: ThreadRuns): TimelineRow[] | undefined {
  if (!rowKey(row).includes(":work-summary:")) return undefined;
  const header = turnButton(row);
  if (header === null || !/\d+\s+\w+/.test(header.textContent ?? "")) return undefined;
  const start = runs?.sourceOf.get(apiId(row));
  if (start === undefined) return undefined;
  let end = start.source.length;
  let next = row.nextElementSibling;
  while (next !== null && (next.hasAttribute(MARKER) || next.hasAttribute(GROUP_END) || next.hasAttribute("data-timeline-window-spacer"))) next = next.nextElementSibling;
  if (next instanceof HTMLElement && next.dataset.timelineRowId !== undefined) {
    const boundary = runs?.sourceOf.get(apiId(next));
    // Native composition can advance before its API snapshot. Do not borrow
    // a call from the next mounted summary to satisfy the current header.
    if (boundary === undefined || boundary.source !== start.source || boundary.index <= start.index) return undefined;
    end = boundary.index;
  }
  const count = domCount(row);
  const members: TimelineRow[] = [];
  for (const entry of start.source.slice(start.index, end)) {
    if (entry.kind === "system" && entry.operationKind === "reasoning") continue;
    if (entry.kind !== "work" || ["approval", "question", "form"].includes(entry.workKind ?? "")) return undefined;
    members.push(entry);
    if (members.length === count) return members;
  }
  return undefined;
}

function indexRuns(rows: TimelineRow[], now: number, visibleRows: Set<string>): ThreadRuns {
  const sourceOf: ThreadRuns["sourceOf"] = new Map();
  const collapsible = new Map<string, boolean>();
  const runOf = new Map<string, number>();
  const counts: number[] = [];
  const firstIds: string[] = [];
  const memberIds: string[][] = [];
  const durationMs: number[] = [];
  const durationKnown: boolean[] = [];
  const pending: boolean[] = [];
  const activity: ToolActivity[] = [];
  const visit = (source: TimelineRow[]) => {
    let open = false;
    for (const [index, row] of source.entries()) {
      sourceOf.set(row.id, { source, index });
      if (row.kind === "turn") {
        collapsible.set(row.id, false);
        visit(row.children ?? []);
        open = false;
        continue;
      }
      const tool = row.kind === "work" && !VISIBLE_WORK.has(row.workKind ?? "") && !visibleRows.has(row.id);
      collapsible.set(row.id, tool);
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
        activity.push("completed");
      }
      open = true;
      runOf.set(row.id, counts.length - 1);
      memberIds[counts.length - 1].push(row.id);
      if (row.kind === "work") {
        const index = counts.length - 1;
        counts[index]++;
        activity[index] = combinedActivity([activity[index], toolActivity(row)]);
        const startedAt = row.startedAt;
        const endedAt = row.status === "pending" ? undefined : row.completedAt ?? undefined;
        if (!Number.isFinite(startedAt) || endedAt === undefined) {
          durationKnown[index] = false;
        } else {
          durationMs[index] += Math.max(0, endedAt - startedAt!);
        }
        if (row.status === "pending") pending[index] = true;
      }
    }
  };
  visit(rows);
  return {
    rows,
    sourceOf,
    collapsible,
    runOf,
    counts,
    firstIds,
    memberIds,
    durationMs: durationMs.map((duration, index) => durationKnown[index] ? duration : null),
    pending,
    activity,
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
  subscribeTimeline?: SubscribeTimeline,
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
  const queuedRefreshes = new Map<string, boolean>();
  const mountedThreads = new Set<string>();
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const turnChoices = new Map<string, boolean>();
  const autoOpenedTurns = new Set<string>();
  const attemptedTurnButtons = new WeakSet<HTMLButtonElement>();
  let openingTurn = false;
  let disposed = false;
  const style = document.createElement("style");
  // Keep the native border/inset. The owner's roomier reading rhythm doubles
  // inner padding from 2 to 4 spacing steps; 2 extra steps + native gap 2 = 4
  // steps after the lower divider (and around the open group's end marker).
  // A temporary stream focus target reuses the native buttons' 1px ring token.
  style.textContent = `[${HIDDEN}]{display:none!important}
[${MARKER}]{padding-bottom:calc(2 * var(--spacing))}
[${MARKER}] [data-row]{margin-inline:calc(2 * var(--spacing));padding-inline:0;border-top:1px solid var(--border);padding-top:calc(4 * var(--spacing))}
[${MARKER}]:has(button[aria-expanded="false"]) [data-row]{border-bottom:1px solid var(--border);padding-bottom:calc(4 * var(--spacing))}
[${GROUP_END}]{margin-inline:calc(2 * var(--spacing));margin-block:calc(2 * var(--spacing));border-bottom:1px solid var(--border)}
[${FLAT_TURN}] > div > [class~="group/timeline-row"]{display:none}
[${FLAT_SUMMARY}] > div > [class~="group/timeline-row"]{display:none}
[${TURN_SHELL}]{display:contents}
[${TURN_SHELL}]::before,[${TURN_SHELL}]::after{display:none}
[${STREAM_FOCUS}]:focus-visible{outline:1px solid var(--ring)}`;
  style.textContent += `
[${MARKER}][data-tool-state="pending"] [data-minus-icon]{animation:var(--animate-spin);opacity:1}
@media(prefers-reduced-motion:reduce){[${MARKER}][data-tool-state="pending"] [data-minus-icon]{animation:none}}`;
  document.head.append(style);

  const iconInView = new WeakMap<Element, boolean>();
  const updateIconMotion = (icon: SVGElement) => {
    icon.style.animationPlayState = document.hidden || iconInView.get(icon) === false ? "paused" : "";
  };
  const iconObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    for (const entry of entries) {
      iconInView.set(entry.target, entry.isIntersecting);
      updateIconMotion(entry.target as SVGElement);
    }
  });
  const updateVisibleIcons = () => {
    for (const icon of document.querySelectorAll<SVGElement>(`[${MARKER}] [data-minus-icon]`)) updateIconMotion(icon);
  };
  document.addEventListener("visibilitychange", updateVisibleIcons);

  let frame = 0;
  const schedule = () => {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(pass);
  };

  function refresh(threadId: string, force = false) {
    const now = clock.now();
    const last = lastFetch.get(threadId);
    const since = last === undefined ? REFETCH_MS : now - last;
    if (disposed || inFlight.has(threadId)) return;
    if (!force && since < REFETCH_MS) {
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
        (rows) => {
          if (!disposed) threads.set(threadId, indexRuns(rows, clock.now(), visibleRows));
        },
        () => {
          // A failed refresh cannot prove that a spacer does not hide a new run boundary.
          threads.delete(threadId);
        },
      )
      .finally(() => {
        inFlight.delete(threadId);
        const queued = queuedRefreshes.get(threadId);
        queuedRefreshes.delete(threadId);
        if (queued !== undefined && mountedThreads.has(threadId)) refresh(threadId, queued);
        schedule();
      });
  }

  function invalidate(threadId: string, finished: boolean) {
    if (disposed || !mountedThreads.has(threadId)) return;
    if (inFlight.has(threadId)) {
      queuedRefreshes.set(threadId, finished || queuedRefreshes.get(threadId) === true);
    } else {
      refresh(threadId, finished);
    }
  }

  function preserveTurnStreams(container: Element, presentation: Set<Element>) {
    for (const row of container.children) {
      if (!(row instanceof HTMLElement)) continue;
      const isTurn = isTopLevelTurn(row);
      const threadId = row.dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
      const api = threads.get(threadId ?? "");
      const members = summaryMembers(row, api);
      const isStreamSummary = rowKey(row).includes(":work-summary:") &&
        (visibleRows.has(row.dataset.timelineRowId ?? "") || visibleRows.has(apiId(row)) || summaryHasAgentWork(row) ||
          members?.some(member => VISIBLE_WORK.has(member.workKind ?? "") || api?.collapsible.get(member.id) === false) || hasAgentContent(row));
      if (!isTurn && !isStreamSummary) continue;
      // Remember a proven stream summary too: an API failure must not hide
      // its protected contents while the bundle is temporarily unmounted.
      if (isStreamSummary) visibleRows.add(row.dataset.timelineRowId!);
      const button = turnButton(row);
      const id = row.dataset.timelineRowId!;
      if (button === null) continue;
      if (button.getAttribute("aria-expanded") === "false" &&
        turnChoices.get(id) !== false && !attemptedTurnButtons.has(button)) {
        // Use bb's existing disclosure. No global preference or React row is changed.
        attemptedTurnButtons.add(button);
        autoOpenedTurns.add(id);
        openingTurn = true;
        try { button.click(); } finally { openingTurn = false; }
      }
      if (button.getAttribute("aria-expanded") !== "true") continue;
      const list = [...row.querySelectorAll<HTMLElement>(isTurn ? '[data-timeline-row-list="nested"]' : '[data-timeline-row-list="bundle"]')]
        .find(list => list.closest("[data-timeline-row-id]") === row);
      if (list === undefined || (isTurn && list.querySelector(".group\\/message") === null)) continue;
      const root = button.parentElement?.parentElement;
      if (root === undefined || root === null || root.parentElement !== row || !root.contains(list)) continue;
      const shells: HTMLElement[] = [];
      let shell = list.parentElement;
      // Stop at the measure row unconditionally, even if bb adds a sibling
      // before its native root. Validate the entire chain before styling it.
      while (shell !== null && shell !== root && shell !== row && root.contains(shell)) {
        shells.push(shell);
        shell = shell.parentElement;
      }
      if (shell !== root) continue;
      // Keep React's rows and virtualization measure box in place. Only remove
      // the enclosing disclosure's visual nesting: commentary is ordinary chat,
      // and each quote continues to control only its own work rows.
      row.setAttribute(isTurn ? FLAT_TURN : FLAT_SUMMARY, "");
      presentation.add(row);
      for (const shell of shells) {
        shell.setAttribute(TURN_SHELL, "");
        presentation.add(shell);
      }
    }
  }

  function clearTurnPresentation(el: Element) {
    const restoreFocus = document.activeElement === el;
    el.removeAttribute(FLAT_TURN);
    el.removeAttribute(FLAT_SUMMARY);
    el.removeAttribute(TURN_SHELL);
    const focusMode = el.getAttribute(STREAM_FOCUS);
    if (focusMode !== null) {
      el.removeAttribute(STREAM_FOCUS);
      if (focusMode === "temporary-tabindex" && el.getAttribute("tabindex") === "-1") el.removeAttribute("tabindex");
      if (restoreFocus && el instanceof HTMLElement) turnButton(el)?.focus({ preventScroll: true });
    }
  }

  function trackTurnChoice(event: Event) {
    if (openingTurn || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    const row = button?.closest<HTMLElement>("[data-timeline-row-id]");
    if (button === null || row === null || row === undefined ||
      (!isTopLevelTurn(row) && !(rowKey(row).includes(":work-summary:") && row.parentElement !== null && isToolContainer(row.parentElement))) ||
      button !== turnButton(row)) return;
    turnChoices.set(row.dataset.timelineRowId!, button.getAttribute("aria-expanded") !== "true");
  }

  function apiRun(rows: HTMLElement[]): {
    key: string;
    count: number;
    durationMs: number | null;
    pending: boolean;
    activity: ToolActivity;
    memberIds: readonly string[];
  } | null {
    const threadId = rows[0].dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
    if (threadId === undefined) return null;
    const runs = threads.get(threadId);
    if (runs === undefined) {
      refresh(threadId);
      return null;
    }
    const summaries = rows.map(row => summaryMembers(row, runs));
    if (rows.some((row, index) => rowKey(row).includes(":work-summary:") &&
      turnButton(row) !== null && summaries[index] === undefined)) {
      refresh(threadId);
      return null;
    }
    if (summaries.some(members => members !== undefined)) {
      const members = new Map<string, TimelineRow>();
      let unknownCount = 0;
      for (const [index, row] of rows.entries()) {
        if (row.dataset.timelineRowId === undefined) continue;
        const summary = summaries[index];
        const run = runs.runOf.get(apiId(row));
        if (summary === undefined && rowKey(row).includes(":work-summary:")) {
          refresh(threadId);
          return null;
        }
        const ids = summary?.map(member => member.id) ?? (run === undefined ? [] : runs.memberIds[run]);
        if (ids.length === 0) unknownCount += domCount(row);
        for (const id of ids) {
          const source = runs.sourceOf.get(id);
          if (source !== undefined) members.set(id, source.source[source.index]);
        }
      }
      let durationMs: number | null = unknownCount > 0 ? null : 0;
      let pending = false;
      for (const member of members.values()) {
        if (VISIBLE_WORK.has(member.workKind ?? "")) return null;
        const end = member.status === "pending" ? undefined : member.completedAt ?? undefined;
        if (!Number.isFinite(member.startedAt) || end === undefined) durationMs = null;
        else if (durationMs !== null) durationMs += Math.max(0, end - member.startedAt!);
        if (member.status === "pending") pending = true;
      }
      if (pending || unknownCount > 0) refresh(threadId);
      const ids = [...members.keys()];
      if (ids.length === 0) return null;
      const activity = combinedActivity([...members.values()].map(toolActivity).concat(unknownCount > 0 ? ["unknown"] : []));
      return { key: "timeline:" + threadId + ":" + ids[0], count: ids.length + unknownCount, durationMs, pending, activity, memberIds: ids };
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
      activity: combinedActivity([runs.activity[first], ...(unknownRows.length > 0 ? ["unknown" as const] : [])]),
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
            if (!isToolRow(next, api, visibleRows)) break;
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
    const icon = el.querySelector<SVGElement>("[data-minus-icon]")!;
    iconObserver?.observe(icon);
    updateIconMotion(icon);
    const toggle = () => {
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
    };
    for (const button of el.querySelectorAll("[data-toggle]")) button.addEventListener("click", toggle);
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
    mountedThreads.clear();
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedMarker = focused?.closest<HTMLElement>(`[${MARKER}]`) ?? null;
    const focusedKey = focusedMarker?.getAttribute(MARKER);
    const focusSelector = focused?.matches('[data-toggle="quote"]') ? '[data-toggle="quote"]' :
      focused?.matches('[data-toggle="metrics"]') ? '[data-toggle="metrics"]' :
      null;
    let migratedFocus: HTMLElement | null = null;
    // Snapshot before rendering so splitting a group can migrate every visible part.
    const previousGroupByRow = new Map(groupKeyByRow);
    const previousChoices = new Map(disclosureChoices);
    const used = new Set<Element>();
    const turnPresentation = new Set<Element>();
    for (const container of document.querySelectorAll("[data-timeline-items]")) {
      if (!isToolContainer(container)) continue;
      preserveTurnStreams(container, turnPresentation);
      for (const child of container.children) {
        if (!(child instanceof HTMLElement)) continue;
        const id = child.dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
        if (id !== undefined) mountedThreads.add(id);
      }
      // A streaming work row can acquire message content after the API response.
      // Keep it as a boundary in the API index too, so adjacent tools do not share a marker.
      for (const row of container.children) {
        if (!(row instanceof HTMLElement) || row.dataset.timelineRowId === undefined || rowKey(row).includes(":work-summary:") ||
          !(hasAgentContent(row) || VISIBLE_WORK_ROW.test(rowKey(row)))) continue;
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
        if (child.dataset.timelineRowId !== undefined && isToolRow(child, threads.get(threadId ?? ""), visibleRows)) {
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
        const quoteButton = el.querySelector<HTMLButtonElement>('[data-toggle="quote"]')!;
        quoteButton.id = quoteId + "-toggle";
        el.querySelector<HTMLLabelElement>("[data-quote-control]")!.htmlFor = quoteButton.id;
        const activity = api?.activity ?? "unknown";
        const icon = el.querySelector<SVGElement>("[data-minus-icon]")!;
        if (el.getAttribute("data-tool-state") !== activity) {
          el.setAttribute("data-tool-state", activity);
          icon.innerHTML = ACTIVITY_ICONS[activity];
        }
        icon.setAttribute("title", ACTIVITY_LABELS[activity]);
        const activityLabel = el.querySelector<HTMLElement>("[data-activity-label]")!;
        activityLabel.id = quoteId + "-activity";
        if (activityLabel.textContent !== ACTIVITY_LABELS[activity]) activityLabel.textContent = ACTIVITY_LABELS[activity];
        const source = QUOTE_SOURCES[quote.source];
        const sourceLocator = quote.locator.replace(
          /^Project Gutenberg plain-text line (\d+)$/,
          "Строка $1 в тексте Project Gutenberg",
        );
        const sourceLink = el.querySelector<HTMLElement>("[data-source]")!;
        sourceLink.id = quoteId + "-source";
        quoteButton.setAttribute("aria-labelledby", quoteId + " " + sourceLink.id);
        if (sourceLink.textContent !== source.byline) sourceLink.textContent = source.byline;
        sourceLink.setAttribute(
          "aria-label",
          source.credit + ". «" + source.title + "». " + sourceLocator + ". Русский перевод Minus.",
        );
        sourceLink.title = source.credit + ". «" + source.title + "». " + sourceLocator + ". Русский перевод Minus.";
        const duration = api?.pending ? null : formatToolTime(api?.durationMs ?? null);
        const metrics = el.querySelector<HTMLElement>("[data-metrics]")!;
        const visibleCount = calls + " tool" + (calls === 1 ? "" : "s");
        if (metrics.textContent !== visibleCount + (duration === null ? "" : " · " + duration)) {
          // Let count and time wrap independently at narrow widths/text zoom,
          // keeping each value with its unit rather than overflowing the inset.
          metrics.querySelector("[data-count]")!.textContent = visibleCount;
          metrics.querySelector("[data-time]")!.textContent = duration ?? "";
          metrics.querySelector("[data-time-separator]")!.textContent = duration === null ? "" : " · ";
        }
        metrics.title = duration === null ? "Время появится после завершения вызовов." :
          "Total time across individual tool calls; parallel calls are added together.";
        const accessibleLabel =
          (open ? "Hide " : "Show ") +
          calls +
          " tool call" +
          (calls === 1 ? "" : "s") +
          (duration === null ? ". Время появится после завершения вызовов." : ". Total tool time: " + duration + ".");
        for (const button of el.querySelectorAll<HTMLButtonElement>("[data-toggle]")) {
          button.setAttribute("aria-label", accessibleLabel);
          button.setAttribute("aria-describedby", quoteId + " " + activityLabel.id);
          button.setAttribute("aria-expanded", String(open));
        }
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
    for (const el of document.querySelectorAll(`[${FLAT_TURN}], [${FLAT_SUMMARY}], [${TURN_SHELL}], [${STREAM_FOCUS}]`)) {
      if (!turnPresentation.has(el)) clearTurnPresentation(el);
    }
    for (const el of document.querySelectorAll(`[${MARKER}], [${GROUP_END}]`)) if (!used.has(el)) {
      const icon = el.querySelector("[data-minus-icon]");
      if (icon !== null) iconObserver?.unobserve(icon);
      el.remove();
    }
    // Replacing a fallback header with an API header must preserve keyboard
    // focus, so the next Enter/Space still acts on the same visible group.
    if (focusedMarker !== null && document.activeElement !== focused) {
      if (used.has(focusedMarker)) focused?.focus({ preventScroll: true });
      else migratedFocus?.focus({ preventScroll: true });
    }
    const focusedTurn = focused?.closest<HTMLElement>(`[${FLAT_TURN}], [${FLAT_SUMMARY}]`);
    if (focusedTurn !== null && focusedTurn !== undefined && focused === turnButton(focusedTurn)) {
      const metrics = focusedTurn.querySelector<HTMLElement>('[data-toggle="metrics"]');
      if (metrics !== null) metrics.focus({ preventScroll: true });
      else {
        if (!focusedTurn.hasAttribute(STREAM_FOCUS)) {
          const hasTabIndex = focusedTurn.hasAttribute("tabindex");
          focusedTurn.setAttribute(STREAM_FOCUS, hasTabIndex ? "preserved-tabindex" : "temporary-tabindex");
          if (!hasTabIndex) focusedTurn.tabIndex = -1;
        }
        focusedTurn.focus({ preventScroll: true });
      }
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("click", trackTurnChoice, true);
  const unsubscribe = subscribeTimeline?.((threadId, finished) => {
    if (threadId === undefined) {
      for (const id of mountedThreads) invalidate(id, finished);
    } else {
      invalidate(threadId, finished);
    }
  });
  pass();

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    observer.disconnect();
    iconObserver?.disconnect();
    document.removeEventListener("visibilitychange", updateVisibleIcons);
    document.removeEventListener("click", trackTurnChoice, true);
    cancelAnimationFrame(frame);
    for (const timer of refreshTimers.values()) clock.clearTimeout(timer);
    refreshTimers.clear();
    queuedRefreshes.clear();
    style.remove();
    for (const el of document.querySelectorAll(`[${MARKER}], [${GROUP_END}]`)) el.remove();
    for (const el of document.querySelectorAll(`[${HIDDEN}]`)) el.removeAttribute(HIDDEN);
    for (const el of document.querySelectorAll(`[${FLAT_TURN}], [${FLAT_SUMMARY}], [${TURN_SHELL}], [${STREAM_FOCUS}]`)) clearTurnPresentation(el);
    for (const row of document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
      const id = row.dataset.timelineRowId!;
      if (!autoOpenedTurns.has(id) || turnChoices.has(id) ||
        (!isTopLevelTurn(row) && !rowKey(row).includes(":work-summary:"))) continue;
      const button = turnButton(row);
      if (button?.getAttribute("aria-expanded") === "true") button.click();
    }
    quoteByGroup.clear();
    quoteByRow.clear();
    expanded.clear();
    groupKeyByRow.clear();
    disclosureChoices.clear();
    rowDisclosureChoices.clear();
    visibleRows.clear();
    mountedThreads.clear();
    turnChoices.clear();
    autoOpenedTurns.clear();
  };
}
