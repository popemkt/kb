/**
 * A field a family manages shows at rest under a note naming the family,
 * and edits after the person's one step, which they can take back; a field
 * nobody manages edits as ever, and a system node's field stays closed.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_IDS } from "@kb/model";
import { schemaOfGraph, type SchemaIndex } from "../lib/schema";
import type { OutlineNode } from "../lib/types";
import { useFieldWrite } from "../lib/field-write";
import { ManagedNote } from "./managed-field";

function node(id: string, text: string, props: OutlineNode["props"] = {}): OutlineNode {
  const at = "2026-11-11T00:00:00.000Z";
  return {
    id,
    text,
    parentId: null,
    children: [],
    collapsed: false,
    props,
    createdAt: at,
    updatedAt: at,
    tags: [],
  };
}

const schema: SchemaIndex = schemaOfGraph(
  new Map(
    [
      node("fam.days", "Days"),
      node("f.key", "period", { [SYSTEM_IDS.managedByField]: [{ t: "ref", v: "fam.days" }] }),
      node("f.note", "note"),
      node("day", "Wed, Nov 11"),
    ].map((n) => [n.id, n]),
  ),
);

/** A row as an editor draws one: its writing, and the note when managed. */
function Row({ nodeId, fieldId }: { nodeId: string; fieldId: string }) {
  const { readOnly, managed } = useFieldWrite(nodeId, fieldId, schema);
  return createElement(
    "div",
    { "data-read-only": String(readOnly) },
    managed === null ? null : createElement(ManagedNote, { managed }),
  );
}

describe("a managed field's row", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const draw = (nodeId: string, fieldId: string) =>
    act(async () => root.render(createElement(Row, { nodeId, fieldId })));
  const readOnly = () =>
    container.querySelector("[data-read-only]")?.getAttribute("data-read-only");
  const note = () => container.querySelector("[data-managed-note]");

  it("shows at rest, naming its family, and edits after Edit until Done", async () => {
    await draw("day", "f.key");
    expect(readOnly()).toBe("true");
    expect(note()?.getAttribute("data-managed-note")).toBe("at-rest");
    expect(note()?.textContent).toBe("managed by DaysEdit");

    await act(async () => note()?.querySelector("button")?.click());
    expect(readOnly()).toBe("false");
    expect(note()?.getAttribute("data-managed-note")).toBe("editing");
    expect(note()?.querySelector("button")?.textContent).toBe("Done");

    await act(async () => note()?.querySelector("button")?.click());
    expect(readOnly()).toBe("true");
  });

  it("a field nobody manages edits with no note", async () => {
    await draw("day", "f.note");
    expect(readOnly()).toBe("false");
    expect(note()).toBeNull();
  });

  it("a system node's field it does not configure stays closed, managed or not", async () => {
    await draw("sys.some.node", "f.key");
    expect(readOnly()).toBe("true");
    expect(note()).toBeNull();
  });
});
