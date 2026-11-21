import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { isQueryNode, SYSTEM_IDS } from "@kb/model";
import { shownNode, type PaletteStep } from "@kb/ui-sdk";
import { addTag } from "./outline-steps";
import { writtenEdn } from "./query-builder/model";

/**
 * Start with the type field's exact tag match, as the Conditions tab edits it.
 * The condition is written only if the node still has no query when the
 * write commits, so a query another tab saved meanwhile is kept.
 */
export const findTagged: PaletteStep = {
  label: "Find nodes tagged…",
  placeholder: "Search tags…",
  icon: <MagnifyingGlassIcon size={12} />,
  candidates: addTag.candidates,
  commit: async ({ targetNodeId, schema, pickedId, writes }) => {
    const row = schema.get(targetNodeId);
    if (row === undefined) return;
    const target = shownNode(row, schema);
    if (isQueryNode(target)) return;
    await writes.initializeProp(target.id, SYSTEM_IDS.queryField, {
      t: "str",
      v: writtenEdn([
        {
          kind: "field-is",
          field: SYSTEM_IDS.typeField,
          values: [{ t: "ref", v: pickedId }],
        },
      ]),
    });
  },
};
