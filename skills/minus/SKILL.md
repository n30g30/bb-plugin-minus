---
name: minus
description: Hide or show bb UI elements (back/forward buttons, sidebar and right panel toggles, "..." menus, "Open in" menu, prompt collapse chevron, thinking rows, thread provider icons, message navigator; collapse tool calls) with the Minus plugin's settings. Use when the user asks to hide or restore a piece of bb's interface.
---

# Minus

Each setting is a boolean; `true` hides the element in every open bb window, live.

```
bb plugin config minus get
bb plugin config minus set <key> true|false
```

Keys: `hideNavButtons`, `hideSidebarToggle` (⌘B still works), `hideRightPanelToggle` (⌘J still works),
`hideFooterMore`, `hideThreadHeaderMore`, `hideThreadRowMore` (right-click still opens thread actions),
`hideOpenIn` (⌘O still opens the default app), `hidePromptCollapse`, `hideMessageNav` (the jump-to-message rail), `hideThinking`, `hideThreadIcons`, `collapseToolCalls` (groups each run of tool/thinking rows into one expandable "Called N tools" row).

Users can also flip them in Settings → Plugins → Minus.
