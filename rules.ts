// Each rule becomes one boolean setting, grouped by the area of bb it belongs to.
// When on, its selectors get display:none (collapseToolCalls has none: see group-tools.ts).
// Selectors target bb's own aria labels and data attributes, verified against bb 0.47.
type Rule = { key: string; label: string; selectors: readonly string[] };

const OPEN_IN = 'button[aria-label^="Open workspace in"],button[aria-label="Choose another app to open workspace"]';

export const AREAS: readonly { title: string; rules: readonly Rule[] }[] = [
  {
    title: "Sidebar",
    rules: [
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
        label: "Hide sidebar toggle",
        selectors: ['button[data-sidebar="trigger"]'],
      },
      {
        key: "hideThreadIcons",
        label: "Hide provider icons on thread rows",
        selectors: ["[data-sidebar-thread-provider]"],
      },
      {
        key: "hideThreadRowMore",
        label: 'Hide "..." on thread rows',
        selectors: ["[data-thread-actions-trigger]"],
      },
      {
        key: "hideFooterMore",
        label: 'Hide footer "More" button',
        selectors: ['button[aria-label="More footer actions"]'],
      },
    ],
  },
  {
    title: "Thread title bar",
    rules: [
      {
        key: "hideThreadHeaderMore",
        label: 'Hide "..." next to the title',
        selectors: ['button[aria-label="Thread actions"]:not([data-thread-actions-trigger])'],
      },
      {
        key: "hideCommit",
        label: 'Hide "Commit" button',
        // No label (its text changes with git state), so match its slot instead.
        selectors: [
          `[data-thread-header-workflow-actions] > [data-thread-header-responsive-action]:not(:has(${OPEN_IN}))`,
        ],
      },
      {
        key: "hideOpenIn",
        label: 'Hide "Open in ..." app menu',
        selectors: [`[data-thread-header-responsive-action]:has(${OPEN_IN})`],
      },
      {
        key: "hideClosePane",
        label: 'Hide "x" close button',
        selectors: ['[data-thread-header-pane-actions] button[aria-label="Close pane"]'],
      },
      {
        key: "hideRightPanelToggle",
        label: "Hide right panel toggle",
        selectors: [
          'button[aria-label^="Show right panel"]:not([role=switch])',
          'button[aria-label^="Hide right panel"]:not([role=switch])',
        ],
      },
    ],
  },
  {
    title: "Chat",
    rules: [
      {
        key: "hideThinking",
        label: "Hide thinking",
        selectors: ['[data-timeline-row-id*=":kind:reasoning"]'],
      },
      {
        key: "collapseToolCalls",
        label: 'Collapse consecutive tool calls into one "Called N tools" row',
        selectors: [],
      },
      {
        key: "hideMessageNav",
        label: "Hide message navigator on the right",
        selectors: ["[data-thread-toc]"],
      },
    ],
  },
  {
    title: "Prompt box",
    rules: [
      {
        key: "hidePromptCollapse",
        label: "Hide collapse chevron",
        selectors: ['button[aria-label="Collapse prompt box"]'],
      },
      {
        key: "hidePromptPlus",
        label: 'Hide "+" button',
        selectors: ['[data-promptbox-action-row] button[aria-label="Prompt actions"]'],
      },
      {
        key: "hideModelSelector",
        label: "Hide model selector",
        selectors: ['[data-promptbox-action-row] button[aria-label^="Provider, model"]'],
      },
      {
        key: "hidePromptProviderIcon",
        label: "Hide provider icon in the model selector",
        selectors: [
          '[data-promptbox-action-row] button[aria-label^="Provider, model"] [aria-hidden="true"]:has(> [data-provider-logo])',
        ],
      },
      {
        key: "hideMic",
        label: "Hide voice input button",
        selectors: ['[data-promptbox-action-row] button[aria-label$="voice input"]'],
      },
      {
        // Send, send options, and stop share this group.
        key: "hideSend",
        label: "Hide send and stop buttons (Enter still sends)",
        selectors: ["[data-promptbox-submit-group]"],
      },
    ],
  },
  {
    title: "Under the prompt box",
    rules: [
      {
        key: "hideComposerFolder",
        label: "Hide project folder",
        selectors: ['[data-follow-up-composer-footer] [data-option-display][title^="Project:"]'],
      },
      {
        key: "hideComposerCheckout",
        label: "Hide checkout",
        selectors: ['[data-follow-up-composer-footer] div:has(> [data-option-display][title^="Environment:"])'],
      },
      {
        key: "hideComposerBranch",
        label: "Hide branch",
        selectors: ["[data-follow-up-composer-footer] button[data-promptbox-hide-branch-compact]"],
      },
      {
        key: "hideComposerNewThread",
        label: "Hide new thread button",
        selectors: ['button[aria-label="New thread in this environment"]'],
      },
      {
        key: "hideComposerContext",
        label: "Hide context fill level",
        selectors: ['[data-follow-up-composer-footer] button[aria-label^="Context window"]'],
      },
    ],
  },
];

// bb's flat declarative settings form, replaced on this plugin's page by the grouped section.
const FLAT_FORM = (pluginId: string) =>
  [
    `[data-resource-detail-section="configuration"]:has(> [data-testid="plugin-detail-${pluginId}"]) > :not([data-testid])`,
    `[data-testid="plugin-detail-${pluginId}"] > :not([data-testid="plugin-settings-sections"])`,
  ].join(",");

export function buildCss(pluginId: string, enabled: (key: string) => boolean): string {
  const rules = AREAS.flatMap((area) => area.rules).filter((rule) => rule.selectors.length > 0 && enabled(rule.key));
  return [FLAT_FORM(pluginId), ...rules.map((rule) => rule.selectors.join(","))]
    .map((selectors) => `${selectors}{display:none!important}`)
    .join("\n");
}
