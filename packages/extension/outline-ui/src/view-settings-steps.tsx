import { SortAscendingIcon, SquaresFourIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { SYSTEM_IDS } from "@kb/model";
import type { ContributionEntry } from "@kb/plugin";
import { browserHost, shownNode, type PaletteStep, type PickerCandidate } from "@kb/ui-sdk";
import { frameFieldCandidates, groupFieldSetting, NO_FIELD } from "./view-settings-fields";

interface FieldSetting {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly choices: (fields: readonly PickerCandidate[]) => PickerCandidate[];
  readonly write: (frameId: string, fieldId: string) => Promise<void>;
}

const FIELD_SETTINGS: readonly FieldSetting[] = [
  {
    id: "group-by",
    label: "Group by field",
    icon: <SquaresFourIcon size={14} />,
    ...groupFieldSetting,
  },
  {
    id: "sort-by",
    label: "Sort by field",
    icon: <SortAscendingIcon size={14} />,
    choices: (fields) => [
      { id: NO_FIELD, label: "Manual order" },
      { id: SYSTEM_IDS.nodeTextField, label: "Name" },
      ...fields.filter(({ id }) => id !== SYSTEM_IDS.nodeTextField),
    ],
    write: (frameId, fieldId) =>
      browserHost().writes.setFrameSetting(
        frameId,
        "sort",
        fieldId === NO_FIELD ? [] : [{ fieldId, dir: "asc" }],
      ),
  },
];

export const VIEW_SETTINGS_STEPS: readonly ContributionEntry<PaletteStep>[] = FIELD_SETTINGS.map(
  ({ id, label, icon, choices, write }) => ({
    id,
    value: {
      label,
      icon,
      placeholder: "Search fields…",
      candidates: ({ anchorId, nodes }) => {
        const row = anchorId === null ? undefined : nodes.get(anchorId);
        if (row === undefined) return [];
        const schema = browserHost().schema();
        return choices(frameFieldCandidates(shownNode(row, schema).id, nodes, schema));
      },
      commit: async ({ targetNodeId, schema, pickedId }) => {
        const row = schema.get(targetNodeId);
        if (row !== undefined) await write(shownNode(row, schema).id, pickedId);
      },
    },
  }),
);
