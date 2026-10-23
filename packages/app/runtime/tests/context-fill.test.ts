/**
 * What a session fills (DESIGN.md → Action registry → What a session fills),
 * over a real session: a call made in a tab session is given the required
 * inputs its action declares from that tab's active pane, never one it
 * gave, never from a nobody's tab, never for a call made inside another;
 * the receipt says what it filled, and a call left without one is refused
 * naming what to pass. Registration refuses a declaration a session could
 * change the meaning of.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import {
  CORE_CONTEXT_REFERENCES,
  CurrentCall,
  CurrentContextReferences,
  Screens,
  actionToManifestEntry,
  contextRefusal,
  type ActionInvocation,
  type ActionReceipt,
  type ContextReferences,
  type KbContext,
  type PaneScreen,
  type ScreensPort,
  type TabScreen,
} from "@kb/contracts";
import { invokeReceiptWith, type RegisteredAction } from "@kb/operations";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKb } from "../src/session.ts";

let root = "";
let ctx: KbContext;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kb-context-fill-"));
  ctx = await openKb(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PERSON = { id: "person.a", name: "A" };

function pane(id: string, focused: string | null): PaneScreen {
  return { id, route: "/", view: null, focused, selection: [] };
}

/** Tab `tab.a`, the person's, its active pane `p2` focused on `n.here`. */
function tab(person: TabScreen["person"] = PERSON): TabScreen {
  return {
    tab: "tab.a",
    person,
    route: "/",
    active: true,
    activePane: "p2",
    panes: [pane("p1", "n.elsewhere"), pane("p2", "n.here")],
  };
}

function screensOf(tabs: readonly TabScreen[]): ScreensPort {
  const none = Effect.die(new Error("not a screen command test"));
  return {
    screen: ({ session }) =>
      Effect.succeed({
        tabs: tabs.filter((shown) => session === undefined || shown.tab === session),
      }),
    navigate: () => none,
    select: () => none,
    capture: () => none,
  };
}

const REFERENCES: ContextReferences = { of: (id) => CORE_CONTEXT_REFERENCES[id] };

const IdInput = z.object({ id: z.string().min(1), note: z.string().optional() });

/** `test.rename` fills `id` from `focused`; `test.outer` makes a `test.rename` call inside itself. */
const ACTIONS: ReadonlyMap<string, RegisteredAction> = new Map([
  [
    "test.rename",
    {
      def: {
        id: "test.rename",
        title: "Rename",
        description: "answers with the id it was given",
        mode: { kind: "read" },
        context: { id: "focused" },
        inputSchema: IdInput,
        outputSchema: IdInput,
      },
      effect: (input: never) => Effect.succeed(input),
      source: "core",
      aliases: [],
    },
  ],
  [
    "test.outer",
    {
      def: {
        id: "test.outer",
        title: "Outer",
        description: "renames inside itself",
        mode: { kind: "read" },
        inputSchema: z.object({}),
        outputSchema: z.unknown(),
      },
      effect: () =>
        Effect.gen(function* () {
          const outer = yield* CurrentCall;
          return yield* invokeReceiptWith(ACTIONS, ctx, {
            id: "test.rename",
            input: {},
            actor: outer?.invocation.actor ?? "cli",
            ...(outer?.invocation.session === undefined
              ? {}
              : { session: outer.invocation.session }),
          });
        }),
      source: "core",
      aliases: [],
    },
  ],
]);

function call(
  invocation: ActionInvocation,
  tabs: readonly TabScreen[] = [tab()],
): Promise<ActionReceipt> {
  return Effect.runPromise(
    invokeReceiptWith(ACTIONS, ctx, invocation).pipe(
      Effect.provideService(Screens, screensOf(tabs)),
      Effect.provideService(CurrentContextReferences, REFERENCES),
      Effect.provide(kbRuntimeLayer(ctx)),
    ),
  );
}

const rename = (input: object, session?: string): ActionInvocation => ({
  id: "test.rename",
  input,
  actor: "agent",
  ...(session === undefined ? {} : { session }),
});

describe("what a session fills", () => {
  test("a call in a person's tab session takes a declared input from its active pane, and says so", async () => {
    const receipt = await call(rename({}, "tab.a"));
    expect(receipt).toEqual({
      status: "succeeded",
      id: "test.rename",
      output: { id: "n.here" },
      context: { id: { from: "focused", value: "n.here" } },
    });
  });

  test("a given input is never replaced", async () => {
    const receipt = await call(rename({ id: "n.given" }, "tab.a"));
    expect(receipt).toEqual({ status: "succeeded", id: "test.rename", output: { id: "n.given" } });
  });

  test("a call in no session is refused, naming what to pass and what could fill it", async () => {
    const receipt = await call(rename({}));
    expect(receipt.status).toBe("failed");
    if (receipt.status !== "failed") return;
    expect(receipt.code).toBe("invalid_input");
    expect(receipt.message).toContain(
      "id is required; pass it, or have the node the pane's focus is on in a tab session",
    );
  });

  test("a nobody's tab fills nothing", async () => {
    const receipt = await call(rename({}, "tab.a"), [tab(null)]);
    expect(receipt.status).toBe("failed");
  });

  test("a session with no tab, or a pane that holds nothing, fills nothing", async () => {
    expect((await call(rename({}, "tab.gone"))).status).toBe("failed");
    const unfocused = { ...tab(), panes: [pane("p1", "n.elsewhere"), pane("p2", null)] };
    const receipt = await call(rename({}, "tab.a"), [unfocused]);
    expect(receipt.status).toBe("failed");
    if (receipt.status === "failed") expect(receipt.message).toContain("in the session's tab");
  });

  test("a call made inside another is never filled, though it is made in the session", async () => {
    const receipt = await call({ id: "test.outer", input: {}, actor: "agent", session: "tab.a" });
    expect(receipt.status).toBe("succeeded");
    if (receipt.status !== "succeeded") return;
    expect(receipt.context).toBeUndefined();
    expect(receipt.output).toMatchObject({ status: "failed", code: "invalid_input" });
  });
});

describe("a session's fill as an action declares it", () => {
  const def = (context: Record<string, string>) => ({
    id: "test.declared",
    title: "Declared",
    description: "declares a fill",
    mode: { kind: "read" as const },
    context,
    inputSchema: IdInput,
    outputSchema: z.unknown(),
  });

  test("only a required input can be filled, from a reference a plugin contributes", () => {
    expect(contextRefusal(def({ id: "focused" }), REFERENCES)).toBeNull();
    expect(contextRefusal(def({ note: "focused" }), REFERENCES)).toContain(
      "note, which its input does not require",
    );
    expect(contextRefusal(def({ id: "ext.gone.open" }), REFERENCES)).toContain(
      "ext.gone.open, which no loaded plugin contributes",
    );
  });

  test("the manifest lists what a session fills, and what that is on a pane", () => {
    expect(
      actionToManifestEntry(def({ id: "focused" }), () => undefined, REFERENCES).context,
    ).toEqual({
      id: { reference: "focused", description: "the node the pane's focus is on" },
    });
    expect(actionToManifestEntry(def({}), () => undefined, REFERENCES).context).toBeUndefined();
  });
});
