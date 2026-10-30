import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import type { TemplateContext } from "@kb/contracts";
import { document } from "./document.ts";

const at = "2026-01-01T00:00:00.000Z";
const TAG = "01TESTCRITERIONTAG00000000";
const ASKS = "01TESTASKSFIELD00000000000";
const TARGET = "01TESTTARGETFIELD000000000";

function node(id: string, text: string, props: KbNode["props"], children: string[] = []): KbNode {
  return { id, text, props, children, createdAt: at, updatedAt: at };
}

const nodes = [
  node(ASKS, "asks", { "sys.f.type": [{ t: "ref", v: "sys.field" }] }),
  node(TARGET, "target", { "sys.f.type": [{ t: "ref", v: "sys.field" }] }),
  node(TAG, "criterion", {
    "sys.f.type": [{ t: "ref", v: "sys.tag" }],
    "sys.f.fields": [
      { t: "ref", v: ASKS },
      { t: "ref", v: TARGET },
    ],
  }),
  node("root", "Framework", {}, ["lede", "first", "second"]),
  node("lede", "Every one is judged by these.", {}),
  node(
    "first",
    "Fidelity",
    {
      "sys.f.type": [{ t: "ref", v: TAG }],
      [TARGET]: [{ t: "str", v: "8/10" }],
      [ASKS]: [{ t: "str", v: "as close as the pic" }],
    },
    ["note"],
  ),
  node("note", "Judged at 1x and 2x.", {}),
  node("second", "Sharpness", { "sys.f.type": [{ t: "ref", v: TAG }] }),
];
const ctx: TemplateContext = {
  nodes: new Map(nodes.map((entry) => [entry.id, entry])),
  fieldIdByName: () => undefined,
};

describe("document template", () => {
  test("renders a node's children in outline order: plain text as paragraphs, tagged nodes as sections with their tag's fields", () => {
    expect(document([["root"]], ctx)).toBe(
      [
        "# Framework",
        "",
        "Every one is judged by these.",
        "",
        "## Fidelity",
        "",
        "- **asks** — as close as the pic",
        "- **target** — 8/10",
        "",
        "Judged at 1x and 2x.",
        "",
        "## Sharpness",
      ].join("\n"),
    );
  });

  test("says so when the query finds nothing", () => {
    expect(document([], ctx)).toBe("_Nothing to show._");
  });
});
