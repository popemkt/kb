/**
 * `extension.settings`' answer (DESIGN.md → Extension families → An
 * extension's configuration is fields on its node): each extension node,
 * core's included, with the settings `settingsOf` reads for it and the
 * values its node holds for each. It repeats nothing `extension.list`
 * reports (whether a family is optional, on, trusted), and leaves out the
 * switch, which `extension.switch` writes.
 */
import { z } from "zod";
import { FIELD_TYPES } from "@kb/model";
import { PropValueSchema } from "./protocol.ts";

const SettingSchema = z.object({
  /** The field node's id, which `kb set <node> <field> …` and `node.update` write. */
  field: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  cardinality: z.enum(["one", "many"]),
  /** The field's option set, in child order: what a ref value may name. Empty when it declares none. */
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  /** What the extension's node holds for it now; empty when unset. */
  values: z.array(PropValueSchema),
});

export const ExtensionSettingsSchema = z.object({
  extensions: z.array(
    z.object({
      /** The extension's name, as `kb ext list` prints it; `core` for core's node. */
      name: z.string(),
      label: z.string(),
      /** The node its settings are written on, `sys.extension.<name>`. */
      node: z.string(),
      settings: z.array(SettingSchema),
    }),
  ),
});
export type ExtensionSettings = z.infer<typeof ExtensionSettingsSchema>;
