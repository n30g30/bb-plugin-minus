import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { RULES } from "./rules";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define(
    Object.fromEntries([
      ...RULES.map((rule) => [rule.key, { type: "boolean", label: rule.label, default: false }]),
      ["collapseToolCalls", { type: "boolean", label: 'Collapse consecutive tool calls into one "Called N tools" row', default: false }],
    ]) as Record<string, { type: "boolean"; label: string; default: boolean }>,
  );
}
