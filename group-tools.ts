// Collapses each run of consecutive tool/thinking rows in the top-level thread timeline
// into one "Called N tools" toggle styled like bb's "Worked for" row. bb owns the rows
// (React), so this only sets an attribute on them and inserts its own sibling markers.
// The timeline is virtualized, so counts come from the timeline API, not mounted rows.

type TimelineRow = { id: string; kind: string };
type FetchTimeline = (threadId: string) => Promise<TimelineRow[]>;

const HIDDEN = "data-bb-minus-hidden";
const MARKER = "data-bb-minus-group";
const NON_TOOL = /^(user|assistant|error|op:thread-provisioning)|:turn(:|$)|kind:(assistant|user)/;
const REFETCH_MS = 2000;

const TOGGLE_HTML = `<div class="rounded-md text-muted-foreground w-full"><div class="group/timeline-row"><button type="button" class="items-center gap-1 overflow-hidden text-left text-sm text-muted-foreground transition-colors duration-150 hover:duration-0 hover:text-foreground focus-visible:text-foreground group/toggle cursor-pointer px-2 flex w-full max-w-full justify-start py-0 leading-5"><span class="min-w-0 max-w-full"><span class="inline-flex min-w-0 max-w-full items-center gap-1.5 opacity-40"><span class="min-w-0 max-w-full text-sm leading-5 inline-flex items-baseline gap-1 overflow-hidden whitespace-nowrap"><span class="shrink-0 whitespace-pre text-subtle-foreground">Called</span> <span data-count class="shrink-0 whitespace-pre text-muted-foreground tabular-nums"></span></span></span></span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="bb-icon-stroke pointer-events-none size-3 shrink-0 origin-center text-subtle-foreground/60 transition-[opacity,rotate] duration-200 ease-out opacity-0 group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden="true"><path d="M6 4l4 4-4 4"></path></svg></button></div></div>`;

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
type ThreadRuns = { runOf: Map<string, number>; counts: number[] };
function indexRuns(rows: TimelineRow[]): ThreadRuns {
  const runOf = new Map<string, number>();
  const counts: number[] = [];
  let open = false;
  for (const row of rows) {
    const tool = row.kind === "work" || (row.kind === "system" && row.id.includes(":op:reasoning:"));
    if (!tool) {
      open = false;
      continue;
    }
    if (!open) counts.push(0);
    open = true;
    runOf.set(row.id, counts.length - 1);
    if (row.kind === "work") counts[counts.length - 1]++;
  }
  return { runOf, counts };
}

export function mountToolGrouping(fetchTimeline: FetchTimeline): () => void {
  const expanded = new Set<string>();
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

  function apiCount(rows: HTMLElement[]): number | null {
    const threadId = rows[0].dataset.timelineRowId?.match(/^thr_[a-z0-9]+/)?.[0];
    if (threadId === undefined) return null;
    const runs = threads.get(threadId);
    const ids = rows.filter((row) => row.dataset.timelineRowId !== undefined).map(apiId);
    const first = runs?.runOf.get(ids[0]);
    const last = runs?.runOf.get(ids[ids.length - 1]);
    if (runs === undefined || first === undefined || last === undefined) {
      refresh(threadId);
      return null;
    }
    let n = 0;
    for (let i = first; i <= last; i++) n += runs.counts[i];
    return n;
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

      for (const rows of runs) {
        const calls =
          apiCount(rows) ??
          rows.reduce((sum, row) => sum + (row.dataset.timelineRowId === undefined ? 0 : domCount(row)), 0);
        if (calls === 0) {
          for (const row of rows) row.removeAttribute(HIDDEN);
          continue;
        }
        const key = rowKey(rows[0]);
        const open = expanded.has(key);
        const el = marker(container, key);
        used.add(el);
        const text = `${calls} tool${calls === 1 ? "" : "s"}`;
        const count = el.querySelector<HTMLElement>("[data-count]")!;
        if (count.textContent !== text) count.textContent = text;
        el.querySelector("button")!.setAttribute("aria-expanded", String(open));
        el.querySelector("svg")!.style.rotate = open ? "90deg" : "";
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
  };
}
