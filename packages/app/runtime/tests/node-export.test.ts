/**
 * `node.export` and `node.addTree`'s formats through the registry every
 * surface invokes (DESIGN.md → Outline formats): what an export writes, and
 * that a paste of it back makes the same tree again.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_IDS, fieldTypeValue, type FieldType, type KbNode } from "@kb/model";
import type { ActionReceipt } from "@kb/contracts";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

type Kb = Awaited<ReturnType<typeof openKb>>;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function succeed(receipt: Promise<ActionReceipt>): Promise<unknown> {
  const r = await receipt;
  if (r.status !== "succeeded") throw new Error(`${r.code}: ${r.message}`);
  return r.output;
}

async function typedField(ctx: Kb, id: string, type: FieldType): Promise<void> {
  await succeed(invoke(ctx, { id: "field.define", input: { name: id, id } }));
  await succeed(
    invoke(ctx, {
      id: "node.update",
      input: { id, setProps: [{ field: SYSTEM_IDS.fieldTypeField, value: fieldTypeValue(type) }] },
    }),
  );
}

const add = (ctx: Kb, id: string, text: string, parent?: string) =>
  succeed(invoke(ctx, { id: "node.add", input: { id, text, parent: parent ?? null } }));

/**
 * A store with a tag, a ref field whose options are its children (two of
 * them named alike), a number field, and a small tree under `n.top`.
 */
async function seeded(): Promise<Kb> {
  const root = await mkdtemp(join(tmpdir(), "kb-export-"));
  roots.push(root);
  const ctx = await openKb(root);
  await succeed(invoke(ctx, { id: "tag.define", input: { name: "project", id: "t.project" } }));
  await typedField(ctx, "status", "ref");
  await add(ctx, "o.doing", "doing", "status");
  await add(ctx, "o.done", "done", "status");
  await add(ctx, "o.twin1", "twin", "status");
  await add(ctx, "o.twin2", "twin", "status");
  await typedField(ctx, "estimate", "number");
  await add(ctx, "n.ada", "Ada");
  await succeed(
    invoke(ctx, {
      id: "node.add",
      input: {
        id: "n.top",
        text: "Plan **the** trip with [[n.ada]]",
        parent: null,
        tags: ["project"],
        props: [
          { field: "status", value: { t: "ref", v: "o.doing" } },
          { field: "estimate", value: { t: "num", v: 3 } },
        ],
      },
    }),
  );
  await add(ctx, "n.child", "Book it", "n.top");
  return ctx;
}

const exported = async (ctx: Kb, input: Record<string, unknown>): Promise<string> =>
  ((await succeed(invoke(ctx, { id: "node.export", input }))) as { text: string }).text;

function node(ctx: Kb, id: string): KbNode {
  const found = ctx.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found;
}

describe("node.export", () => {
  test("writes Markdown by default: what a person reads, references as words", async () => {
    const ctx = await seeded();
    expect(await exported(ctx, { ids: ["n.top"] })).toBe(
      [
        "- Plan **the** trip with Ada #project",
        "  - status:: doing",
        "  - estimate:: 3",
        "  - Book it",
      ].join("\n"),
    );
  });

  test("writes the source with references as ids: every tag and field by id", async () => {
    const ctx = await seeded();
    expect(await exported(ctx, { ids: ["n.top"], format: "tana", refs: "id" })).toBe(
      [
        "%%tana%%",
        "- Plan **the** trip with [[n.ada]] #t.project",
        "  - status:: [[o.doing]]",
        "  - estimate:: 3",
        "  - Book it",
      ].join("\n"),
    );
  });

  test("a row under another row given goes with it; without children each row is alone", async () => {
    const ctx = await seeded();
    expect(await exported(ctx, { ids: ["n.child", "n.top"], fieldsAndTags: false })).toBe(
      "- Plan **the** trip with Ada\n  - Book it",
    );
    expect(
      await exported(ctx, { ids: ["n.top", "n.child"], children: false, format: "plain" }),
    ).toBe("Plan the trip with Ada\nBook it");
  });

  test("an id the store does not hold is refused", async () => {
    const ctx = await seeded();
    const receipt = await invoke(ctx, { id: "node.export", input: { ids: ["n.nowhere"] } });
    expect(receipt.status).toBe("failed");
    expect(receipt.status === "failed" && receipt.code).toBe("not_found");
  });
});

describe("a paste back makes the same tree again", () => {
  for (const format of ["md", "logseq", "tana", "json"] as const) {
    test(`${format}, written with references as ids`, async () => {
      const ctx = await seeded();
      const text = await exported(ctx, { ids: ["n.top"], format, refs: "id" });
      const output = (await succeed(
        invoke(ctx, { id: "node.addTree", input: { outline: text, format, parent: null } }),
      )) as { ids: string[] };
      const [copy] = output.ids;
      expect(copy).toBeDefined();
      expect(copy).not.toBe("n.top");
      expect(await exported(ctx, { ids: [copy] })).toBe(await exported(ctx, { ids: ["n.top"] }));
      const [, child] = output.ids;
      expect(node(ctx, copy ?? "").children).toEqual([child ?? ""]);
    });
  }

  test("JSON keeps a text the grammar would read as marks byte for byte", async () => {
    const ctx = await seeded();
    const text = "#word name:: value\n%%tana%% and [[n.ada]] and [[n.ada|my label]]";
    await add(ctx, "n.marks", text);
    const json = await exported(ctx, { ids: ["n.marks"], format: "json", refs: "id" });
    const output = (await succeed(
      invoke(ctx, { id: "node.addTree", input: { outline: json, format: "json", parent: null } }),
    )) as { ids: string[] };
    const copy = node(ctx, output.ids[0] ?? "");
    expect(copy.text).toBe(text);
    expect(copy.props[SYSTEM_IDS.typeField]).toBeUndefined();
  });

  test("Rich text has no reader, and saying so names it", async () => {
    const ctx = await seeded();
    const receipt = await invoke(ctx, {
      id: "node.addTree",
      input: { outline: "<ul><li>a</li></ul>", format: "html", parent: null },
    });
    expect(receipt.status === "failed" && receipt.message).toContain(
      "Rich text (html) has no reader",
    );
  });
});

/** Paste a task whose status is `value`, as text. */
const pasteStatus = (ctx: Kb, value: string) =>
  invoke(ctx, {
    id: "node.addTree",
    input: { outline: `- Task\n  - status:: ${value}`, parent: null },
  });

describe("an option of a field whose options are its children, by its text", () => {
  test("resolves to that option's id", async () => {
    const ctx = await seeded();
    const output = (await succeed(pasteStatus(ctx, "done"))) as { ids: string[] };
    expect(node(ctx, output.ids[0] ?? "").props["status"]).toEqual([{ t: "ref", v: "o.done" }]);
  });

  test("an id is read first, before any option's text", async () => {
    const ctx = await seeded();
    const output = (await succeed(pasteStatus(ctx, "o.twin2"))) as { ids: string[] };
    expect(node(ctx, output.ids[0] ?? "").props["status"]).toEqual([{ t: "ref", v: "o.twin2" }]);
  });

  test("a text two options share is refused, with the reason and the line", async () => {
    const ctx = await seeded();
    const before = ctx.log.head;
    const receipt = await pasteStatus(ctx, "twin");
    expect(receipt.status).toBe("failed");
    expect(receipt.status === "failed" && receipt.message).toBe(
      "outline line 2: 2 options are named twin; name one by its id instead",
    );
    expect(ctx.log.head).toBe(before);
  });
});
