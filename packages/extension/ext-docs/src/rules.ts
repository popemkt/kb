import type { KbNode, NodeId } from "@kb/model";
import { renderText, type TemplateContext } from "@kb/contracts";
import { cell, fieldLines, nodesTagged, propText, rowIds, tagIdsNamed } from "./nodes.ts";

/**
 * The `rules` template: the repo's rule and gap index, rendered from the
 * graph. Policy, so it lives with the policy that asks for it — registered
 * as `ext.docs.rules` with the bare id `rules` as an alias.
 */

/** Strongest enforcement first, so `prose` rows (nothing checks them) sink. */
const ENFORCEMENT_ORDER = ["hook", "ci", "harness", "tsc", "lint", "prose"];

function enforcementRank(value: string): number {
  const i = ENFORCEMENT_ORDER.indexOf(value);
  return i >= 0 ? i : ENFORCEMENT_ORDER.length;
}

/** A gap's fields, in the order its section lists them. */
const GAP_FIELDS = ["expected", "current", "impact", "closes", "rule"];

function appendGapSection(
  lines: string[],
  heading: string,
  gapNodes: KbNode[],
  emptyMessage: string,
  ctx: TemplateContext,
): void {
  lines.push("", `## ${heading}`, "");
  if (gapNodes.length === 0) lines.push(emptyMessage);
  for (const node of gapNodes) {
    lines.push(`### ${renderText(node.text, ctx)}`, "");
    const fields = GAP_FIELDS.map((field) => ctx.fieldIdByName(field)).filter(
      (id): id is NodeId => id !== undefined,
    );
    lines.push(...fieldLines(ctx, node, fields));
    lines.push(`- **node** — \`${node.id}\``, "");
  }
}

/**
 * `#rule` nodes as a table with an honest enforcement column, then the
 * `#gap` nodes. Rows: `[[nodeId], …]` — the gaps come from the graph, so
 * one view renders the whole rules index.
 */
export function rules(rows: unknown[][], ctx: TemplateContext): string {
  const ruleNodes = rowIds(rows)
    .map((id) => ctx.nodes.get(id))
    .filter((n): n is KbNode => n !== undefined)
    .toSorted(
      (a, b) =>
        enforcementRank(propText(ctx, a, "enforcement") ?? "") -
          enforcementRank(propText(ctx, b, "enforcement") ?? "") || a.text.localeCompare(b.text),
    );

  const lines = [
    "# Rules",
    "",
    "Every rule that governs this repo, with its one home and what actually",
    "checks it. `enforcement` is honest: **`prose` means nothing checks it** —",
    "`gate` names the check that will.",
    "",
    "## Rules",
    "",
    "| Rule | Home | Scope | Principle | Enforcement | Gate |",
    "|---|---|---|---|---|---|",
  ];
  if (ruleNodes.length === 0) {
    lines.push("| _no rules recorded_ | — | — | — | — | — |");
  }
  for (const node of ruleNodes) {
    lines.push(
      `| ${cell(renderText(node.text, ctx))} | ${cell(propText(ctx, node, "home"))} | ` +
        `${cell(propText(ctx, node, "scope"))} | ${cell(propText(ctx, node, "principle"))} | ` +
        `${cell(propText(ctx, node, "enforcement"))} | ${cell(propText(ctx, node, "gate"))} |`,
    );
  }

  const allGapNodes = nodesTagged(ctx, tagIdsNamed(ctx, "gap")).toSorted(
    (a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id),
  );
  const activeGapNodes = allGapNodes.filter((node) => propText(ctx, node, "status") !== "done");
  const closedGapNodes = allGapNodes.filter((node) => propText(ctx, node, "status") === "done");
  appendGapSection(lines, "Gaps", activeGapNodes, "_No gaps recorded._", ctx);
  appendGapSection(lines, "Closed", closedGapNodes, "_No closed gaps recorded._", ctx);

  return lines.join("\n");
}
