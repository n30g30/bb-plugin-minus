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
`hideOpenIn` (⌘O still opens the default app), `hideCommit`, `collapseQueue` (queue starts collapsed), `hidePromptCollapse`, `hidePromptPlaceholder`, `hideClosePane`, `hideComposerFolder`, `hideComposerCheckout`, `hideComposerBranch`, `hideComposerNewThread`, `hideComposerContext`, `hidePromptPlus`, `hideModelSelector`, `hidePromptProviderIcon`, `hideMic`, `hideSend` (send, send options and stop; Enter still sends), `hideMessageActions` (copy/edit/side chat/"..." under messages), `hideSteerLabel`, `hideCodeBlockActions` (wrap/copy on code blocks), `hideMessageNav` (the jump-to-message rail), `hideThinking`, `hideThreadIcons`, `collapseToolCalls` (groups each continuous tool block behind one short Russian quote with inline author attribution; the count and expand/collapse action remain accessible).

When `collapseToolCalls` is enabled, the collapsed row keeps the Russian quote,
Russian author/source attribution without a link, visible tool count, and final summed tool runtime in a muted
summary. Its text wraps as the chat narrows; the quote, metrics and source stay
gray on hover and focus, with a visible keyboard focus ring. Quotes are curated
to read as self-contained thoughts. Parallel calls contribute their individual runtimes to the sum;
the manual "Stopped manually" row stays separate and is not counted.
Users can also flip the settings in Settings → Plugins → Minus.

Quote and Russian attribution flow together without a forced line break and wrap naturally with the chat width. During execution the ring spins and duration stays hidden; after the complete tool cycle it becomes a static circle with a dot and the final duration appears. Times use seconds, then minutes/seconds, then hours/minutes. Reduced-motion preferences are respected; offscreen and background animations pause.

Collapsing tools keeps reasoning, unknown streaming rows, nested agent timelines and delegation/workflow streams visible. When a completed stage is open, its commentary uses the normal chat inset without an enclosing Worked for disclosure; quote and metrics controls reveal only the tool rows. Turning grouping off restores the native presentation. Approval, question and form rows remain available for the user to respond. The summary reads quote → Russian author/source → tool count and total time, with a shared native horizontal inset.
