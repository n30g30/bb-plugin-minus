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
    key: "hideClosePane",
    label: 'Hide "x" close button in the thread title bar',
    selectors: ['[data-thread-header-pane-actions] button[aria-label="Close pane"]'],
  },
  {
    key: "hideComposerFolder",
    label: "Hide project folder under the prompt box",
    selectors: ['[data-follow-up-composer-footer] [data-option-display][title^="Project:"]'],
  },
  {
    key: "hideComposerCheckout",
    label: "Hide checkout under the prompt box",
    selectors: ['[data-follow-up-composer-footer] div:has(> [data-option-display][title^="Environment:"])'],
  },
  {
    key: "hideComposerBranch",
    label: "Hide branch under the prompt box",
    selectors: ["[data-follow-up-composer-footer] button[data-promptbox-hide-branch-compact]"],
  },
  {
    key: "hideComposerNewThread",
    label: "Hide new thread button under the prompt box",
    selectors: ['button[aria-label="New thread in this environment"]'],
  },
  {
    key: "hideComposerContext",
    label: "Hide context fill level under the prompt box",
    selectors: ['[data-follow-up-composer-footer] button[aria-label^="Context window"]'],
  },
  {
    key: "hidePromptPlus",
    label: 'Hide "+" button in the prompt box',
    selectors: ['[data-promptbox-action-row] button[aria-label="Prompt actions"]'],
  },
  {
    key: "hideModelSelector",
    label: "Hide model selector in the prompt box",
    selectors: ['[data-promptbox-action-row] button[aria-label^="Provider, model"]'],
  },
  {
    key: "hidePromptProviderIcon",
    label: "Hide provider icon in the model selector",
    selectors: ['[data-promptbox-action-row] button[aria-label^="Provider, model"] span[title]:has([data-provider-logo])'],
  },
  {
    key: "hideMic",
    label: "Hide voice input button in the prompt box",
    selectors: ['[data-promptbox-action-row] button[aria-label$="voice input"]'],
  },
  {
    // The stop button shares this slot while a turn runs; keep it.
    key: "hideSend",
    label: "Hide send button in the prompt box (Enter still sends)",
    selectors: ['[data-promptbox-submit-action]:not([aria-label="Stop run"])'],
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
