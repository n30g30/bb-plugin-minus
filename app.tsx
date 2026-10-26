import { useEffect } from "react";
import { definePluginApp, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { mountToolGrouping } from "./group-tools";
import { buildCss } from "./rules";

// Mounted once per window; re-renders when settings change, so toggles apply live.
function HideStyles() {
  const { values } = useSettings();
  const css = buildCss((key) => values?.[key] === true);
  const collapseToolCalls = values?.collapseToolCalls === true;
  const sdk = useSdk();
  useEffect(() => {
    if (!collapseToolCalls) return;
    return mountToolGrouping(async (threadId) => (await sdk.threads.timeline({ threadId, deferContent: "true" })).rows);
  }, [collapseToolCalls, sdk]);
  return css === "" ? null : <style data-bb-minus="">{css}</style>;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "hide-styles", component: HideStyles });
});
