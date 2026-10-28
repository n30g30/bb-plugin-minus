## What you get

Twenty-seven switches in Settings, one per element, all off by default:

- The padding and rounded corners around the workbench in the macOS app
- Back and forward buttons
- Left sidebar toggle and right panel toggle
- The "..." buttons in the sidebar footer, next to the thread title, and on sidebar thread rows
- The "Open in ..." app menu in the thread header
- The chevron that collapses the prompt box
- Plus one switch that opens the message queue collapsed instead of expanded
- The "x" close button and the "Commit" button in the thread title bar
- Under the prompt box: project folder, checkout, branch, new thread button, and context fill level
- In the prompt box: the "+" button, model selector, provider icon, voice input button, and send/stop buttons (Enter still sends)
- The copy, edit, side chat and "..." actions that appear when you hover a message
- The wrap and copy buttons on code blocks
- The message navigator on the right edge of the chat
- Thinking rows in the chat
- Provider icons on sidebar thread rows

Changes apply in every open window within about a second, without a reload. Keyboard shortcuts keep working for hidden controls (⌘B, ⌘J, ⌘O), and right-clicking a thread row still opens its menu.

## Collapse tool calls

One more switch folds each run of consecutive tool calls and thinking rows in the chat into a single row styled after the native "Worked for" row. The one-line row shows an italic Russian quote, linked author/source, a visible tool count, and the summed runtime of those calls. Its text uses BB's muted foreground token; hover and keyboard focus remain visible. Click the row to show the original calls again. Counts and runtimes come from the complete thread timeline, so they include virtualized calls and update while a call is running. Concurrent calls are added together, so the total can exceed the group's wall-clock duration. A manual "Stopped manually" row stays visible outside the group and is excluded from both metrics.

## How it works

The plugin hides bb's own elements by their labels and data attributes. A bb update that renames an element brings it back until the plugin is updated. Agents can toggle the switches with `bb plugin config minus set <key> true`.
