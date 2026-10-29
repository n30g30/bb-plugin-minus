// Each rule becomes one boolean setting, grouped by the area of bb it belongs to.
// When on, its selectors get display:none and its css is added (collapseToolCalls and collapseQueue have neither: see group-tools.ts, collapse-queue.ts).
// Selectors target bb's own aria labels and data attributes, verified against bb 0.47.
type Rule = { key: string; label: string; selectors: readonly string[]; css?: string };

const OPEN_IN = 'button[aria-label^="Open workspace in"],button[aria-label="Choose another app to open workspace"]';

export const AREAS: readonly { title: string; rules: readonly Rule[] }[] = [
  {
    title: "Window",
    rules: [
      {
        // macOS desktop frames the workbench as a card: an 8px lip on the sides and bottom,
        // rounded corners from --bb-frame-card-radius and an SVG mask with a fixed 8px radius.
        key: "hideWindowFrame",
        label: "Remove padding and rounded corners around the workbench (macOS app)",
        selectors: [],
        css: ":root{--bb-frame-window-lip:0px!important;--bb-frame-card-radius:0px!important;--bb-window-card-mask:none!important;--bb-window-card-mask-square-left:none!important}[data-framed]{--bb-window-frame-lip:0px!important;--bb-window-frame-leading-lip:0px!important}",
      },
    ],
  },
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
        // An empty group renders a "No threads" placeholder row instead of a thread section.
        key: "hideEmptyProjects",
        label: "Hide projects with no threads",
        selectors: [
          '[data-sidebar-sticky-group]:has(> .mt-1 > div > svg[data-icon="MessageSquare"]):not(:has([data-sidebar-sticky-section]))',
        ],
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
        // bb reserves a 28px slot at the row's end for the status glyph and hover actions.
        // With no glyph, collapse it so the title runs to the edge; hover actions still overlay it.
        css: "[data-sidebar-thread-trailing]:not(:has([data-sidebar-thread-trailing-indicator])) > span > span:has(> .bb-sidebar-hover-actions){width:0!important}",
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
        // The label row above a steering message; drop the whole row when the label is its only item.
        key: "hideSteerLabel",
        label: 'Hide "Steer" label on steering messages',
        selectors: [
          '.group\\/message > div:has(> span:only-child > svg[data-icon="ArrowTurnForward"])',
          '.group\\/message span:has(> svg[data-icon="ArrowTurnForward"])',
        ],
      },
      {
        key: "hideThinking",
        label: "Hide thinking",
        selectors: ['[data-timeline-row-id*=":kind:reasoning"]'],
      },
      {
        key: "collapseToolCalls",
        label: "Collapse consecutive calls into a quote and timing row",
        selectors: [],
      },
      {
        // The row under each message that holds copy, edit, side chat and "..." (fades in on hover).
        key: "hideMessageActions",
        label: "Hide message hover actions (copy, edit, side chat, ...)",
        // visibility, not display: the row keeps its height so message spacing stays the same.
        selectors: [],
        css: '[data-timeline-row-id] div:has(> div > button[aria-label="Message actions"]),[data-timeline-row-id] div:has(> div > button[aria-label="Message actions"]) *{visibility:hidden!important}',
      },
      {
        // Wrap and copy sit in one group in the code block header; the language label stays.
        key: "hideCodeBlockActions",
        label: "Hide wrap and copy buttons on code blocks",
        // With no language label the header is empty, so drop it and pad the code like its bottom edge.
        // With a label, drop only the buttons and keep the label row.
        selectors: [
          '[data-clipboard-ignore]:has(> span:empty):has(button[aria-label="Wrap lines"])',
          '[data-clipboard-ignore] > div:has(button[aria-label="Wrap lines"])',
        ],
        css: '[data-clipboard-ignore]:has(> span:empty):has(button[aria-label="Wrap lines"]) + pre{padding-top:.75rem!important}',
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
        key: "collapseQueue",
        label: "Collapse the message queue by default",
        selectors: [],
      },
      {
        key: "hidePromptCollapse",
        label: "Hide collapse chevron",
        selectors: ['button[aria-label="Collapse prompt box"]'],
      },
      {
        key: "hidePromptPlaceholder",
        label: "Hide placeholder text",
        selectors: [],
        css: "[data-promptbox] [data-placeholder]::before{content:none!important}",
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
  const rules = AREAS.flatMap((area) => area.rules).filter((rule) => enabled(rule.key));
  return [
    ...[FLAT_FORM(pluginId), ...rules.filter((r) => r.selectors.length > 0).map((r) => r.selectors.join(","))].map(
      (selectors) => `${selectors}{display:none!important}`,
    ),
    ...rules.flatMap((r) => (r.css === undefined ? [] : [r.css])),
  ].join("\n");
}
