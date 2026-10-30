import { useEffect, useState } from "react";
import { definePluginApp, experimental_usePluginId, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { mountQueueCollapse } from "./collapse-queue";
import { mountToolGrouping } from "./group-tools";
import { AREAS, buildCss } from "./rules";

// Mounted once per window; re-renders when settings change, so toggles apply live.
function HideStyles() {
  const { values } = useSettings();
  const pluginId = experimental_usePluginId();
  const css = buildCss(pluginId, (key) => values?.[key] === true);
  const collapseToolCalls = values?.collapseToolCalls === true;
  const sdk = useSdk();
  useEffect(() => {
    if (!collapseToolCalls) return;
    return mountToolGrouping(
      async (threadId) => (await sdk.threads.timeline({ threadId, deferContent: "true", includeNestedRows: "true" })).rows,
      undefined,
      undefined,
      (notify) => {
        const unsubscribeThread = sdk.subscribe({
          event: "thread:changed",
          callback: (event) => {
            if (!event.changes.some(change =>
              ["events-appended", "status-changed", "history-compacted", "history-rewritten"].includes(change),
            )) return;
            notify(event.id, event.changes.includes("status-changed") ||
              event.metadata?.eventTypes?.includes("turn/completed") === true);
          },
        });
        const unsubscribeConnection = sdk.subscribe({
          event: "realtime:connection",
          callback: (event) => {
            if (event.state === "connected" && event.reconnected) notify(undefined, true);
          },
        });
        return () => { unsubscribeThread(); unsubscribeConnection(); };
      },
    );
  }, [collapseToolCalls, sdk]);
  const collapseQueue = values?.collapseQueue === true;
  useEffect(() => (collapseQueue ? mountQueueCollapse() : undefined), [collapseQueue]);
  return <style data-bb-minus="">{css}</style>;
}

// Classes copied from bb's declarative settings form so the grouped cards match it.
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  const state = checked ? "checked" : "unchecked";
  return (
    <div className="@container/settings w-full min-w-0">
      <div className="flex flex-row items-center justify-between gap-5">
        <div className="min-w-0 flex-1">
          <p className="min-w-0 text-sm font-normal text-foreground">{label}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label={label}
          aria-checked={checked}
          data-state={state}
          onClick={() => onChange(!checked)}
          className="peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input shadow-xs outline-none transition-colors duration-150 hover:duration-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:bg-foreground data-[state=unchecked]:border-input data-[state=unchecked]:bg-muted"
        >
          <span
            aria-hidden="true"
            data-state={state}
            className="pointer-events-none block size-3 rounded-full bg-background ring-0 transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-foreground"
          />
        </button>
      </div>
    </div>
  );
}

function GroupedSettings() {
  const { values } = useSettings();
  const pluginId = experimental_usePluginId();
  const sdk = useSdk();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // Optimistic until the next settings snapshot arrives (also picks up `bb plugin config` changes).
  useEffect(() => setPending({}), [values]);
  const set = (key: string, next: boolean) => {
    setPending((p) => ({ ...p, [key]: next }));
    sdk.plugins.updateSettings({ pluginId, values: { [key]: next } }).then(
      () => setError(null),
      (cause: unknown) => {
        setPending(({ [key]: _, ...rest }) => rest);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  };
  return (
    <div className="space-y-6">
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {AREAS.map((area) => (
        <section key={area.title} className="space-y-3">
          <div className="flex min-h-6 items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">{area.title}</h2>
          </div>
          <div className="space-y-4 overflow-hidden rounded-md border border-border bg-surface-recessed/70 px-3 py-3">
            {area.rules.map((rule) => (
              <Toggle
                key={rule.key}
                label={rule.label}
                checked={pending[rule.key] ?? values?.[rule.key] === true}
                onChange={(next) => set(rule.key, next)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "hide-styles", component: HideStyles });
  app.slots.settingsSection({ id: "grouped-settings", component: GroupedSettings });
});
