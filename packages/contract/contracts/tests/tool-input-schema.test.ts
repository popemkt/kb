/**
 * The input schema every surface publishes for an action's tool
 * (`toolInputSchema`): an object at the root, and an input a tab session may
 * fill said to be so, left out of `required` only where the surface's calls
 * are made in a session.
 */
import { describe, expect, test } from "bun:test";
import { toolInputSchema } from "@kb/contracts";

const RENAME = {
  inputSchema: {
    type: "object" as const,
    properties: { id: { type: "string", description: "The node" }, text: { type: "string" } },
    required: ["id"],
  },
  context: { id: { reference: "focused", description: "the node the pane's focus is on" } },
};

describe("a tool's input schema", () => {
  test("a schema that is not an object is published as one that takes nothing", () => {
    expect(toolInputSchema({ inputSchema: { type: "string" } })).toEqual({
      type: "object",
      properties: {},
    });
  });

  test("an input with no session fill is published as declared", () => {
    expect(toolInputSchema({ inputSchema: RENAME.inputSchema }, true)).toEqual(RENAME.inputSchema);
  });

  test("where calls are made in no session, a fillable input stays required and says a session could fill it", () => {
    expect(toolInputSchema(RENAME)).toEqual({
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "The node. A call made in a tab session may leave it out for the node the pane's focus is on.",
        },
        text: { type: "string" },
      },
      required: ["id"],
    });
  });

  test("where calls are made in a session, it may be left out", () => {
    const schema = toolInputSchema(RENAME, true);
    expect(schema.required).toEqual([]);
    expect(schema.properties).toMatchObject({
      id: {
        description:
          "The node. Left out, it is the node the pane's focus is on in the call's tab session.",
      },
    });
  });
});
