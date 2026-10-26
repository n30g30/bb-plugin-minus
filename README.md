# bb-plugin-minus

A [bb](https://getbb.app) plugin that hides UI elements you do not want to see,
and can collapse tool calls in the chat into one "Called N tools" row.

## Install

```
bb plugin install git:https://github.com/n30g30/bb-plugin-minus.git@^0.2.0
```

Then flip switches in Settings → Plugins → Minus, or from a shell:

```
bb plugin config minus set hideThinking true
```

Keys: `hideWindowFrame`, `hideNavButtons`, `hideSidebarToggle`, `hideRightPanelToggle`,
`hideFooterMore`, `hideThreadHeaderMore`, `hideThreadRowMore`, `hideOpenIn`,
`collapseQueue`, `hidePromptCollapse`, `hideCommit`, `hideClosePane`, `hideComposerFolder`,
`hideComposerCheckout`, `hideComposerBranch`, `hideComposerNewThread`,
`hideComposerContext`, `hidePromptPlus`, `hideModelSelector`,
`hidePromptProviderIcon`, `hideMic`, `hideSend`, `hideMessageActions`, `hideCodeBlockActions`, `hideMessageNav`, `hideThinking`, `hideThreadIcons`,
`collapseToolCalls`.

## How it works

Each rule in `rules.ts` is one boolean setting, grouped by area (`AREAS`);
enabled rules are rendered as a `display:none` stylesheet by an app overlay
(`app.tsx`), so toggles apply live without a reload. The settings page shows the
switches grouped by area in a plugin settings section, which replaces bb's flat
form on that page. Add an element by appending `{ key, label, selectors }` to
an area. Prefer bb's aria labels and `data-*` attributes over Tailwind classes.

`collapseToolCalls` is not CSS: `group-tools.ts` hides each run of tool and
thinking rows in the top-level timeline and inserts a "Called N tools" toggle
copied from bb's "Worked for" row. bb virtualizes the timeline, so N comes
from `sdk.threads.timeline()` (`kind: "work"` rows), refetched at most every
2s when unseen rows mount.

## License

MIT
