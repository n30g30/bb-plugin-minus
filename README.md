# bb-plugin-minus

A [bb](https://getbb.app) plugin that hides UI elements you do not want to see,
and can collapse each continuous block of tool calls in the chat behind one
short Russian quote with inline author attribution.

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
"Worked for" row. The summary shows a curated, self-contained Russian quote,
Russian author/source attribution without a link, and a visible tool count.
The text wraps naturally as the chat narrows. Quote, metrics and source keep
BB's muted foreground token, including on hover and focus; keyboard focus has
a visible ring. bb virtualizes the timeline, so counts and runtimes come from
`sdk.threads.timeline()` (`kind: "work"` rows), including work that is not
currently mounted. Concurrent calls are added together, so the total can exceed
the group's wall-clock duration. A manual "Stopped manually" row stays visible
outside the group and is excluded from both metrics. Each call is counted once,
even when native summaries overlap. Adjacent API runs share one quote when no
visible message or other meaningful boundary separates them.

While calls are running, a native spinning ring indicates activity and the
duration is hidden. After the whole cycle finishes, the icon becomes a static
circle with a dot and the summed tool duration appears. Durations use seconds,
then minutes and seconds, then hours and minutes. Reduced-motion preferences
are respected; offscreen and background animations pause.

## License

MIT

Collapsing tools keeps reasoning, unknown streaming rows, nested agent timelines and delegation/workflow streams visible. When a completed stage is open, its commentary uses the normal chat inset without an enclosing Worked for disclosure; quote and metrics controls reveal only the tool rows. Turning grouping off restores the native presentation. Approval, question and form rows remain available for the user to respond. The summary reads quote → Russian author/source → tool count and total time, with a shared native horizontal inset.

The current accepted UI reference is [one summary per continuous tool block, 2026-10-31](docs/product-journal/2026-10-31-quote-flood.md), accepted by the owner in the Minus thread: “Теперь без флуда, оставляем”. It extends the accepted [ring, dot, disclosure arrow and final time](docs/product-journal/2026-10-30-ring-arrow.md) and the earlier divider/spacing decisions. Agent streams remain outside the dividers; quote and Russian attribution flow together without a link or forced line break. The [motion check and fork integration decision](docs/product-journal/2026-10-31-motion-pr.md) preserve this visual reference.
