/**
 * The command table (`cli.ts`): a command's program holds only the commands
 * its module declares, so another command's options and their parsers never
 * load with it; help holds them all, in the table's order.
 */
import { expect, test } from "bun:test";
import { programFor } from "../src/cli.ts";

const names = async (...args: string[]) =>
  (await programFor(["bun", "kb", ...args])).commands.map((command) => command.name());

test("kb get holds the node commands alone, not kb ui and its options", async () => {
  expect(await names("--root", "ui", "get", "some-id", "--json")).toEqual([
    "add",
    "set",
    "unset",
    "get",
    "export",
    "rm",
    "mv",
  ]);
});

test("kb ui holds kb ui alone", async () => {
  expect(await names("ui", "--port", "0")).toEqual(["ui"]);
});

test("help, no command and an unknown one hold every command, as the table lists them", async () => {
  const every = await names("--help");
  expect(every).toEqual([
    "mcp",
    "ui",
    "init",
    "store",
    "add",
    "set",
    "unset",
    "get",
    "export",
    "rm",
    "mv",
    "field",
    "tag",
    "ontology",
    "query",
    "run",
    "search",
    "backlinks",
    "children",
    "ext",
    "trust",
    "locations",
    "open",
    "procedure",
    "migrate",
    "trace",
    "suggest",
    "relate",
    "docs",
    "check",
    "merge-jsonl",
    "action-invoke",
  ]);
  expect(await names()).toEqual(every);
  expect(await names("help", "get")).toEqual(every);
  expect(await names("gte")).toEqual(every);
});

test("every command a module declares is the table's: its name loads that module alone", async () => {
  const every = await names();
  for (const name of every) {
    const held = await names(name);
    expect(held).toContain(name);
    expect(held.length).toBeLessThan(every.length);
  }
});
