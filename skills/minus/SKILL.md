---
name: minus
description: Hide or show bb UI elements (back/forward buttons, sidebar and right panel toggles, "..." menus, "Open in" menu, title bar close button, prompt box buttons and footer items, prompt collapse chevron, thinking rows, thread provider icons, message navigator; collapse tool calls) with the Minus plugin's settings. Use when the user asks to hide or restore a piece of bb's interface.
---

# Minus

Each setting is a boolean; `true` hides the element in every open bb window, live.

```
bb plugin config minus get
bb plugin config minus set <key> true|false
```

Keys: `hideWindowFrame` (macOS app workbench padding and rounded corners), `hideEmptyProjects`, `hideNavButtons`, `hideSidebarToggle` (⌘B still works), `hideRightPanelToggle` (⌘J still works),
`hideFooterMore`, `hideThreadHeaderMore`, `hideThreadRowMore` (right-click still opens thread actions),
`hideOpenIn` (⌘O still opens the default app), `hideCommit`, `collapseQueue` (queue starts collapsed), `hidePromptCollapse`, `hidePromptPlaceholder`, `hideClosePane`, `hideComposerFolder`, `hideComposerCheckout`, `hideComposerBranch`, `hideComposerNewThread`, `hideComposerContext`, `hidePromptPlus`, `hideModelSelector`, `hidePromptProviderIcon`, `hideMic`, `hideSend` (send, send options and stop; Enter still sends), `hideMessageActions` (copy/edit/side chat/"..." under messages), `hideSteerLabel`, `hideCodeBlockActions` (wrap/copy on code blocks), `hideMessageNav` (the jump-to-message rail), `hideThinking`, `hideThreadIcons`, `collapseToolCalls` (groups each run of tool/thinking rows behind a short Russian quote with its source link; the count and expand/collapse action remain accessible).

When `collapseToolCalls` is enabled, the collapsed row keeps the Russian quote,
author/source link, visible tool count, and summed tool runtime in a muted
summary. Its text wraps as the chat narrows; the quote, metrics and source stay
gray on hover and focus, with a visible keyboard focus ring. Quotes are curated
to read as self-contained thoughts. Parallel calls contribute their individual runtimes to the sum;
the manual "Stopped manually" row stays separate and is not counted.
Users can also flip the settings in Settings → Plugins → Minus.
