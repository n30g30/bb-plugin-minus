# bb-plugin-minus

A [bb](https://getbb.app) plugin that hides UI elements you do not want to see,
and can collapse tool calls in the chat behind a short Russian quote linked to
its source.

## Install

```
bb plugin install git:https://github.com/n30g30/bb-plugin-minus.git@^0.2.0
```

Then flip switches in Settings → Plugins → Minus, or from a shell:

```
bb plugin config minus set hideThinking true
```

Keys: `hideWindowFrame`, `hideEmptyProjects`, `hideNavButtons`, `hideSidebarToggle`, `hideRightPanelToggle`,
`hideFooterMore`, `hideThreadHeaderMore`, `hideThreadRowMore`, `hideOpenIn`,
`collapseQueue`, `hidePromptCollapse`, `hidePromptPlaceholder`, `hideCommit`, `hideClosePane`, `hideComposerFolder`,
`hideComposerCheckout`, `hideComposerBranch`, `hideComposerNewThread`,
`hideComposerContext`, `hidePromptPlus`, `hideModelSelector`,
`hidePromptProviderIcon`, `hideMic`, `hideSend`, `hideMessageActions`, `hideSteerLabel`, `hideCodeBlockActions`, `hideMessageNav`, `hideThinking`, `hideThreadIcons`,
`collapseToolCalls`.

## How it works

Each rule in `rules.ts` is one boolean setting, grouped by area (`AREAS`);
enabled rules are rendered as a `display:none` stylesheet by an app overlay
(`app.tsx`), so toggles apply live without a reload. The settings page shows the
switches grouped by area in a plugin settings section, which replaces bb's flat
form on that page. Add an element by appending `{ key, label, selectors }` to
an area. Prefer bb's aria labels and `data-*` attributes over Tailwind classes.

`collapseToolCalls` is not CSS: `group-tools.ts` hides each run of tool rows in the top-level timeline and inserts a row styled after the native
"Worked for" row. The summary shows a curated, self-contained Russian quote, linked
author/source, a visible tool count, and the summed runtime across those calls.
The text wraps naturally as the chat narrows. Quote, metrics and source keep
BB's muted foreground token, including on hover and focus; keyboard focus has
a visible ring. bb virtualizes the timeline, so counts and runtimes come from
`sdk.threads.timeline()` (`kind: "work"` rows), including work that is not
currently mounted. Concurrent calls are added together, so the total can exceed
the group's wall-clock duration. A manual "Stopped manually" row stays visible
outside the group and is excluded from both metrics.

Author names and work titles in the visible source link are shown in Russian. The complete link label wraps with the chat width; the original source URL stays unchanged.

## License

MIT

Collapsing tools keeps reasoning, unknown streaming rows, nested agent timelines and delegation/workflow streams visible. Approval, question and form rows remain available for the user to respond. The summary reads quote → Russian author/source → tool count and total time, with a shared native horizontal inset.

The current accepted UI reference is [tool-group dividers, 2026-10-30](docs/product-journal/2026-10-30-dividers.md), approved by the owner in the Minus thread: a wrapping muted quote, Russian author/source, call count and time, with dividers around the group. Agent streams remain outside the dividers.
