import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_IDS } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { useNodeSections, type NodeSection } from "./node-sections";
import { schemaOf } from "./schema";
import { wireToOutlineMap } from "./graph-view";
import { useNodes, useSchema } from "../hooks";
import { useContributions } from "./plugins";

vi.mock("../hooks", () => ({ useNodes: vi.fn(), useSchema: vi.fn() }));
vi.mock("./plugins", () => ({ useContributions: vi.fn() }));

const ref = (v: string) => [{ t: "ref" as const, v }];
const node = (id: string, props: WireNode["props"] = {}): WireNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
});
const Body = () => null;
function Probe() {
  return createElement(
    "span",
    null,
    useNodeSections("day")
      .map((s) => s.id)
      .join(","),
  );
}

describe("node sections in a scoped outline", () => {
  for (const inherited of [false, true]) {
    it(`resolves hidden family settings${inherited ? " and inherited tags" : ""} from the full graph`, () => {
      const wire = [
        node("day", { [SYSTEM_IDS.typeField]: ref(inherited ? "my-day" : "day-tag") }),
        node("my-day", { [SYSTEM_IDS.extendsField]: ref("day-tag") }),
        node("day-tag"),
        node("family", { enabled: [{ t: "bool", v: true }] }),
      ];
      const scoped = wireToOutlineMap(
        wire.filter((n) => n.id === "day"),
        new Set(),
        wire,
      );
      vi.mocked(useNodes).mockReturnValue(scoped);
      vi.mocked(useSchema).mockReturnValue(schemaOf({ wireNodes: wire }));
      const section: NodeSection = {
        title: "Days",
        order: 0,
        tags: ["day-tag"],
        Component: Body,
        shown: (graph) => graph.get("family")?.props.enabled?.[0]?.v === true,
      };
      vi.mocked(useContributions).mockReturnValue([
        { id: "days", value: section, aliases: [], owner: "days" },
      ]);
      expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>days</span>");
      expect(scoped.has("day")).toBe(true);
      for (const hidden of ["family", "day-tag", "my-day"]) expect(scoped.has(hidden)).toBe(false);
      const off = wire.map((n) => (n.id === "family" ? node("family") : n));
      vi.mocked(useSchema).mockReturnValue(schemaOf({ wireNodes: off }));
      expect(renderToStaticMarkup(createElement(Probe))).toBe("<span></span>");
    });
  }
});
