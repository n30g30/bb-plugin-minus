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

Keys: `hideWindowFrame` (macOS app workbench padding and rounded corners), `hideNavButtons`, `hideSidebarToggle` (⌘B still works), `hideRightPanelToggle` (⌘J still works),
`hideFooterMore`, `hideThreadHeaderMore`, `hideThreadRowMore` (right-click still opens thread actions),
`hideOpenIn` (⌘O still opens the default app), `hideCommit`, `collapseQueue` (queue starts collapsed), `hidePromptCollapse`, `hideClosePane`, `hideComposerFolder`, `hideComposerCheckout`, `hideComposerBranch`, `hideComposerNewThread`, `hideComposerContext`, `hidePromptPlus`, `hideModelSelector`, `hidePromptProviderIcon`, `hideMic`, `hideSend` (send, send options and stop; Enter still sends), `hideMessageActions` (copy/edit/side chat/"..." under messages), `hideCodeBlockActions` (wrap/copy on code blocks), `hideMessageNav` (the jump-to-message rail), `hideThinking`, `hideThreadIcons`, `collapseToolCalls` (groups each run of tool/thinking rows behind a short Russian quote with its source link; the count and expand/collapse action remain accessible).

Users can also flip them in Settings → Plugins → Minus.
