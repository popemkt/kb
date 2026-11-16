/**
 * Field display on a store written before show (DESIGN.md → Data model →
 * field display): show reads the old hidden checkbox rather than migrating
 * it, so the store opens as it is, with nothing pending, and a field a
 * person hid reads as hidden, a chip.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fieldShowOf, fieldTypeValue, SYSTEM_IDS, type KbNode } from "@kb/model";
import { invoke } from "../src/invoke.ts";
import { openKb } from "../src/session.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-field-display-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const AT = "2026-10-01T00:00:00.000Z";

test("a field hidden with the old checkbox reads as hidden, with no migration pending", async () => {
  const hid: KbNode = {
    id: "f.archived",
    text: "archived",
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("text")],
      [SYSTEM_IDS.hiddenField]: [{ t: "bool", v: true }],
    },
    children: [],
    createdAt: AT,
    updatedAt: AT,
  };
  await mkdir(join(root, ".kb"), { recursive: true });
  await writeFile(join(root, ".kb", "nodes.jsonl"), `${JSON.stringify(hid)}\n`);

  const ctx = await openKb(root);
  const listed = await invoke(ctx, { id: "migration.list", input: {} });
  if (listed.status !== "succeeded") throw new Error(JSON.stringify(listed));
  const migrations = (listed.output as { migrations: { id: string; pending: boolean }[] })
    .migrations;
  expect(migrations.filter((m) => m.pending)).toEqual([]);

  const nodeOf = (id: string) => ctx.nodes.find((node) => node.id === id);
  expect(nodeOf("f.archived")?.props[SYSTEM_IDS.hiddenField]).toEqual([{ t: "bool", v: true }]);
  expect(fieldShowOf(nodeOf("f.archived")?.props)).toBe("hidden");
  // The checkbox itself is owned now, so its row leaves the field pages.
  expect(fieldShowOf(nodeOf(SYSTEM_IDS.hiddenField)?.props)).toBe("never");
});
