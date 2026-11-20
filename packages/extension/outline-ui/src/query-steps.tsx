import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { SYSTEM_IDS } from "@kb/model";
import { browserHost, type PaletteStep } from "@kb/ui-sdk";
import { addTag } from "./outline-steps";
import { writtenEdn } from "./query-builder/model";

/** Start with the type field's exact tag match, as the Conditions tab edits it. */
export const findTagged: PaletteStep = {
  label: "Find nodes tagged…",
  placeholder: "Search tags…",
  icon: <MagnifyingGlassIcon size={12} />,
  candidates: addTag.candidates,
  commit: ({ targetNodeId, pickedId }) =>
    browserHost().writes.updateProp(targetNodeId, SYSTEM_IDS.queryField, {
      t: "str",
      v: writtenEdn([
        {
          kind: "field-is",
          field: SYSTEM_IDS.typeField,
          values: [{ t: "ref", v: pickedId }],
        },
      ]),
    }),
};
