import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { AREAS } from "./rules";

// Descriptors keep `bb plugin config minus` working; the settings page shows the grouped section from app.tsx.
export default async function plugin(bb: BbPluginApi) {
  bb.settings.define(
    Object.fromEntries(
      AREAS.flatMap((area) =>
        area.rules.map((rule) => [rule.key, { type: "boolean", label: `${area.title}: ${rule.label}`, default: false }]),
      ),
    ) as Record<string, { type: "boolean"; label: string; default: boolean }>,
  );
}
