// Each rule becomes one boolean setting; when on, its selectors get display:none.
// Selectors target bb's own aria labels and data attributes, verified against bb 0.47.
export const RULES = [
  {
    key: "hideNavButtons",
    label: "Hide back/forward buttons",
    // The Browser panel has its own unshortcut "Go back"; keep it.
    selectors: [
      'button[aria-label="Go back"][aria-keyshortcuts]',
      'button[aria-label="Go forward"][aria-keyshortcuts]',
    ],
  },
  {
    key: "hideSidebarToggle",
    label: "Hide left sidebar toggle",
    selectors: ['button[data-sidebar="trigger"]'],
  },
  {
    key: "hideRightPanelToggle",
    label: "Hide right panel toggle",
    selectors: [
      'button[aria-label^="Show right panel"]:not([role=switch])',
      'button[aria-label^="Hide right panel"]:not([role=switch])',
    ],
  },
  {
    key: "hideFooterMore",
    label: 'Hide sidebar footer "More" button',
    selectors: ['button[aria-label="More footer actions"]'],
  },
  {
    key: "hideThreadHeaderMore",
    label: 'Hide "..." next to the thread title',
    selectors: ['button[aria-label="Thread actions"]:not([data-thread-actions-trigger])'],
  },
  {
    key: "hideThreadRowMore",
    label: 'Hide "..." on sidebar thread rows',
    selectors: ["[data-thread-actions-trigger]"],
  },
  {
    key: "hideOpenIn",
    label: 'Hide "Open in ..." app menu in the thread header',
    selectors: [
      '[data-thread-header-responsive-action]:has(button[aria-label^="Open workspace in"],button[aria-label="Choose another app to open workspace"])',
    ],
  },
  {
    key: "hidePromptCollapse",
    label: "Hide prompt box collapse chevron",
    selectors: ['button[aria-label="Collapse prompt box"]'],
  },
  {
    key: "hideMessageNav",
    label: "Hide message navigator on the right of the chat",
    selectors: ["[data-thread-toc]"],
  },
  {
    key: "hideThinking",
    label: "Hide thinking in the chat",
    selectors: ['[data-timeline-row-id*=":kind:reasoning"]'],
  },
  {
    key: "hideThreadIcons",
    label: "Hide provider icons on sidebar thread rows",
    selectors: ["[data-sidebar-thread-provider]"],
  },
] as const;

export type RuleKey = (typeof RULES)[number]["key"];

export function buildCss(enabled: (key: RuleKey) => boolean): string {
  return RULES.filter((rule) => enabled(rule.key))
    .map((rule) => `${rule.selectors.join(",")}{display:none!important}`)
    .join("\n");
}
