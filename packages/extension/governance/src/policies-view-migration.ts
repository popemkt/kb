import type { ExtensionMigration } from "@kb/contracts";
import { canonicalJson, SYSTEM_IDS, viewOptionId, type KbNode } from "@kb/model";
import { GOVERNANCE_IDS } from "./policy.ts";

const LEGACY_ID = "view.approval.policies";
const LEGACY_PROPS: KbNode["props"] = {
  [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("outline.table") }],
  [SYSTEM_IDS.viewDisplayField]: [
    { t: "ref", v: GOVERNANCE_IDS.matchField },
    { t: "ref", v: GOVERNANCE_IDS.actorField },
    { t: "ref", v: GOVERNANCE_IDS.decisionField },
  ],
};
const LEGACY_LINK = [{ t: "ref", v: LEGACY_ID }];

export const policiesViewMigration: ExtensionMigration = {
  id: "policies-default-view",
  title: "Open approval policies in the store's default view",
  description:
    "Detach the original unchanged table from the approval policies query so it follows the store's default view. Keep the saved table and any customized view choices.",
  run: ({ nodeOf, at }) => {
    const query = nodeOf(GOVERNANCE_IDS.policies);
    const view = nodeOf(LEGACY_ID);
    if (query === undefined || view === undefined) return { upserts: [], deletes: [] };

    const { [SYSTEM_IDS.viewsField]: links, ...props } = query.props;
    const originalLink = canonicalJson(links ?? []) === canonicalJson(LEGACY_LINK);
    const originalView =
      view.text === "" &&
      view.children.length === 0 &&
      canonicalJson(view.props) === canonicalJson(LEGACY_PROPS);
    return {
      upserts: originalLink && originalView ? [{ ...query, props, updatedAt: at }] : [],
      deletes: [],
    };
  },
};
