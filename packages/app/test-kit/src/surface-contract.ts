/**
 * The surface contract: what every surface that projects the action registry
 * promises. It is written once and run over all of the surfaces together.
 *
 * The registry is the source of truth. A surface (the CLI's
 * `action-invoke`, the MCP server, the HTTP API, the page's WebMCP tools, the
 * sidebar agent's tools) is a way to reach it and
 * must add nothing and drop nothing. It lists the same ids with the same
 * declared modes, and for the same call it returns the same receipt as the
 * invoke core of the composition it reaches (a `kb ui` also reports the
 * extensions it hosts, and reaches their actions). A guarantee kept by one surface and broken by another is
 * exactly what this suite catches, so it is not a per-adapter test.
 *
 * Every property runs against a fresh scratch root. That root holds one
 * fixture extension with an action that declares approval, which no core
 * action does, so every surface shows how it lists such a declaration. One
 * `kb ui` serves the root for the whole property, as
 * one serves a real root: the surfaces that speak to a server (HTTP, the
 * page's WebMCP) speak to that one, and none starts a second over the same
 * root. The whole suite runs once for each way a `kb ui` listens, a TCP port
 * and a Unix socket: every surface keeps its promises whichever the server
 * it reaches listens on.
 */
import { extensionModule, writeTrustedExtensionEffect } from "./extension-files.ts";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import {
  ActionPoint,
  DecidedEntrySchema,
  listedOn,
  onWire,
  requestOf,
  type ActionRequest,
  type ActionMode,
  type ActionReceipt,
  type HostedFamilies,
  type SurfaceWire,
  type UiListener,
} from "@kb/contracts";
import { SYSTEM_IDS, extensionNodeId } from "@kb/model";
import {
  bunFileSystemLayer,
  invoke,
  invokeReceiptEffect,
  kbRuntimeLayer,
  manifest,
  openKb,
} from "@kb/runtime";
import { FAKE_TAB_SCREEN, FakeTab } from "./fake-tab.ts";

/** One listed action, as a surface's own listing states it. */
export interface ListedAction {
  id: string;
  mode: ActionMode;
}

/** A surface under test, bound to one kb root and speaking its own protocol. */
export interface ActionSurface {
  /**
   * The actions this surface lists, taken from its own listing (a tool list,
   * a manifest route, a manifest call) and not from the registry.
   */
  list(): Promise<readonly ListedAction[]>;
  /**
   * The receipt this surface returns for the call, rebuilt from its wire
   * form. A surface whose wire cannot carry `approved` drops it, just as a
   * real caller of that surface would. `null` means the wire has no way to
   * make the call at all (WebMCP cannot call a tool it did not register),
   * which only an action the surface leaves out of its listing may be.
   */
  invoke(invocation: ActionRequest): Promise<ActionReceipt | null>;
  /**
   * What this surface's wire can carry, as the surface itself declares it.
   * The properties below prove the declaration by behaviour.
   */
  readonly wire: SurfaceWire;
  /**
   * Whose composition answers a call: the root's `kb ui` (`ui`), which also
   * reports the extensions it hosts, or the surface's own process (`own`),
   * which hosts none. The invoke core it is held to is that composition's.
   */
  readonly host: "ui" | "own";
  /**
   * Which tab session a call on this surface is made in: the one the call
   * names (`stated`: the envelope, MCP's `_meta`), or the surface's own tab
   * whatever the call names (`own`: the page's WebMCP tools, kb's agent),
   * which the page's and the agent's own tests prove.
   */
  readonly session: "stated" | "own";
  close(): Promise<void>;
}

/** The `kb ui` serving the root under test. */
export interface LiveUi {
  /** Where it listens: a TCP port, or a Unix socket and its proxy's origin. */
  readonly at: UiListener;
  /** What it hosts beside the registry: its extensions' rows and the kernel its actions are in. */
  readonly hosted: HostedFamilies;
  stop(): Promise<void>;
}

/** How a `kb ui` listens: each kind of `UiListener`. */
export type UiListenerKind = UiListener["kind"];

/** Every kind of listener, each named once, so a new kind joins the suite or fails to compile. */
const LISTENER_KINDS = { tcp: "tcp", socket: "socket" } as const satisfies {
  readonly [K in UiListenerKind]: K;
};

/**
 * Start a `kb ui` over a root, listening the way `kind` says; the contract
 * stops it when the property ends.
 */
export type ServeUi = (root: string, kind: UiListenerKind) => Promise<LiveUi>;

/**
 * Open the surface over a root that already exists, has been opened once, and
 * that `ui` serves.
 */
export type SurfaceFactory = (root: string, ui: LiveUi) => Promise<ActionSurface>;

/** The fixture's write that declares approval. */
const APPROVAL_ACTION = "ext.gated.stamp";

/** An extension's node every store holds (core's), and a field the root declares a setting of it. */
const EXTENSION_NODE = extensionNodeId("core");
const SETTING_FIELD = "sys.f.surface-contract-setting";

/**
 * The root's setting: a system field that configures core's node, as a
 * family's own seeded field would. Only a system field is a setting, so the
 * owner mints it with force.
 */
const SETTING_INVOCATION: ActionRequest = {
  id: "node.add",
  input: {
    id: SETTING_FIELD,
    force: true,
    text: "surface contract setting",
    props: [
      { field: SYSTEM_IDS.typeField, value: { t: "ref", v: SYSTEM_IDS.field } },
      { field: SYSTEM_IDS.configuresField, value: { t: "ref", v: EXTENSION_NODE } },
    ],
  },
};

/** The one tab connected to the root's `kb ui`, which applies every command it gets. */
const CONTRACT_TAB = "tab.surface-contract";
const MISSING_TAB = "tab.surface-contract-missing";
/** A second tab, opened after the contract's own, so a command made in no session goes to it. */
const LATER_TAB = "tab.surface-contract-later";
/** The tabs a fill reads, one per surface, each focused on a node of its own. */
const FOCUS_TAB = "tab.surface-contract-focus";

/**
 * A write with no side effect and a fixed output, so that receipts from
 * different surfaces can be compared, which declares approval. Its schemas
 * are bare `{parse}` objects, so the module imports nothing but the SDK and
 * loads from any scratch directory.
 */
const GATED_EXTENSION = extensionModule("gated", {
  prelude: `const passthrough = { parse: (input) => input ?? {} };`,
  actions: `[
  {
    id: "stamp",
    title: "stamp",
    description: "a write for the surface contract",
    mode: { kind: "write", approval: "required" },
    inputSchema: passthrough,
    outputSchema: passthrough,
    handler: async () => ({ stamped: true }),
  },
]`,
});

/**
 * Calls whose receipts do not depend on when or where they run: reads, each
 * kind of failure, the listing itself, a call to the gated action, and the
 * screen actions against the root's one tab, which answers every command
 * the same way.
 */
const CALLS: readonly ActionRequest[] = [
  { id: "kb.manifest", input: {} },
  { id: "node.get", input: { id: "sys.tag", depth: 0 } },
  { id: "node.get", input: { id: "n.surface-contract-missing" } },
  { id: "node.get", input: {} },
  {
    id: "graph.query",
    input: { query: '[:find ?id :where [?e :node/id "sys.tag"] [?e :node/id ?id]]' },
  },
  { id: "render.views", input: {} },
  { id: "render.view", input: { id: "lens.all-mentions", format: "md" } },
  // An outline kb refuses writes nothing: a line that does not parse, a ref nothing names.
  { id: "node.addTree", input: { outline: "- a\n    - b\n  - c" } },
  { id: "node.addTree", input: { outline: "- see [[n.surface-contract-missing]]" } },
  // A proposal kb refuses writes nothing, so every surface sees the same refusal.
  { id: "view.propose", input: { view: "outline.nope" } },
  { id: "view.propose", input: { view: "outline.board", params: { groupFieldId: 7 } } },
  { id: APPROVAL_ACTION, input: {} },
  // A system field that is not one of an extension's settings is not written on its node.
  {
    id: "node.update",
    input: {
      id: EXTENSION_NODE,
      setProps: [
        { field: SYSTEM_IDS.colorField, value: { t: "str", v: "red" } },
        { field: SETTING_FIELD, value: { t: "str", v: "beside the color" } },
      ],
    },
  },
  { id: "ui.screen", input: {} },
  { id: "ui.screen", input: { session: MISSING_TAB } },
  { id: "ui.navigate", input: { route: "/canvas" } },
  { id: "ui.navigate", input: {} },
  { id: "ui.navigate", input: { camera: { preset: "front" } } },
  { id: "ui.capture", input: { view: { preset: "top" } } },
  { id: "ui.select", input: { selection: [] } },
  { id: "ui.select", input: { focus: "sys.tag" }, session: MISSING_TAB },
];

/** `kb.manifest`'s output: each action with what is decided about its caller's call. */
const DecidedManifestSchema = z.object({ actions: z.array(DecidedEntrySchema) });

/** A receipt as data on the wire: what any surface can faithfully return. */
function asWireData(receipt: ActionReceipt): unknown {
  return JSON.parse(JSON.stringify(receipt));
}

/** `action` as a wire that cannot carry approval may list it: its mode without `approval`. */
function withoutApproval(action: ListedAction): ListedAction {
  if (action.mode.kind !== "write") return action;
  const { approval: _approval, ...mode } = action.mode;
  return { id: action.id, mode };
}

function byId(actions: readonly ListedAction[]): ListedAction[] {
  return actions.map(({ id, mode }) => ({ id, mode })).toSorted((a, b) => a.id.localeCompare(b.id));
}

/** A scratch root holding the gated extension, removed when the scope closes. */
const scratchRoot = Effect.acquireRelease(
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "kb-surface-contract-")));
    yield* writeTrustedExtensionEffect(root, "gated.ts", GATED_EXTENSION);
    return root;
  }),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
);

/**
 * The root's one `kb ui`, with one tab connected to it, both gone when the
 * scope closes. Every surface reaches that one tab: HTTP and WebMCP through
 * the server, the CLI, MCP and the invoke core through `.kb/ui.json`.
 */
function serveRoot(serve: ServeUi, root: string, kind: UiListenerKind) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const ui = yield* Effect.promise(() => serve(root, kind));
      return { ui, tab: yield* FakeTab.open(ui.at, CONTRACT_TAB) };
    }),
    ({ ui, tab }) => tab.close.pipe(Effect.andThen(Effect.promise(() => ui.stop()))),
  );
}

/** One surface over the root, closed when the scope closes. */
function openSurface(open: SurfaceFactory, root: string, ui: LiveUi) {
  return Effect.acquireRelease(
    Effect.promise(() => open(root, ui)),
    (surface) => Effect.promise(() => surface.close()),
  );
}

/** What one property checks against one surface. */
interface SurfaceCase {
  readonly name: string;
  readonly surface: ActionSurface;
  readonly root: string;
  /** The root's `kb ui`. */
  readonly ui: LiveUi;
  /**
   * The invoke core's receipt for the call, on the same root, as it arrives
   * from this surface: made by the actor the surface declares for it.
   */
  readonly core: (invocation: ActionRequest) => Effect.Effect<ActionReceipt>;
  /** The surface's receipt for the call, or `null` when its wire cannot make it. */
  readonly via: (invocation: ActionRequest) => Effect.Effect<ActionReceipt | null>;
}

/** What the contract runs over: how a root is served, and the surfaces by name. */
export interface SurfaceSet {
  readonly serve: ServeUi;
  readonly surfaces: Readonly<Record<string, SurfaceFactory>>;
}

/** The set as one run of the suite takes it: with the way its `kb ui` listens. */
interface OnListener extends SurfaceSet {
  readonly listener: UiListenerKind;
}

/**
 * Each surface in turn over one scratch root. The root is opened once first,
 * so the system seed and the root's setting are written before any surface
 * opens it, and every surface then reads the same store; then its one
 * `kb ui` starts, listening as the run says. The
 * surfaces run one after another because each owns process-wide resources
 * (stdout, a port).
 */
function overSurfaces(
  { serve, surfaces, listener }: OnListener,
  check: (c: SurfaceCase) => Effect.Effect<void>,
): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratchRoot;
        const ctx = yield* Effect.promise(() => openKb(root));
        const written = yield* Effect.promise(() => invoke(ctx, SETTING_INVOCATION));
        expect(written.status).toBe("succeeded");
        const { ui } = yield* serveRoot(serve, root, listener);
        yield* Effect.forEach(
          Object.entries(surfaces),
          ([name, open]) =>
            Effect.scoped(
              Effect.gen(function* () {
                const surface = yield* openSurface(open, root, ui);
                // The composition the surface reaches: the registry, and on a kb ui what it hosts.
                const hosted = surface.host === "ui" ? ui.hosted : undefined;
                const core = (invocation: ActionRequest) =>
                  invokeReceiptEffect(ctx, onWire(surface.wire, invocation)).pipe(
                    Effect.provide(kbRuntimeLayer(ctx, undefined, hosted)),
                  );
                const via = (invocation: ActionRequest) =>
                  Effect.promise(() => surface.invoke(invocation));
                yield* check({ name, surface, root, ui, core, via });
              }),
            ),
          { discard: true },
        );
      }),
    ),
  );
}

/**
 * `call` as `surface` makes it: a surface that makes its calls in its own
 * tab session (`own`) makes them in none here, since its tab publishes no
 * screen, whatever session the call names.
 */
function asMadeOn(surface: ActionSurface, call: ActionRequest): ActionRequest {
  if (surface.session === "stated") return call;
  const { session: _named, ...made } = call;
  return made;
}

const PROPERTIES: ReadonlyArray<readonly [string, (set: OnListener) => Promise<void>]> = [
  [
    "every surface lists the action ids of what it reaches (the registry's, and on a kb ui " +
      "what it hosts) with their declared modes, " +
      "leaving out only what is denied to its actor or asks where its wire cannot approve",
    (set) =>
      overSurfaces(set, ({ name, surface, root, ui, core }) =>
        Effect.gen(function* () {
          const registry = yield* manifest(root).pipe(Effect.provide(bunFileSystemLayer));
          expect(registry.some((entry) => entry.id === APPROVAL_ACTION)).toBe(true);
          // What the invoke core reaches for this surface's caller, and what the guards decide.
          const decided = yield* core({ id: "kb.manifest", input: {} });
          const { actions } = DecidedManifestSchema.parse(
            decided.status === "succeeded" ? decided.output : null,
          );
          // The registry's actions, then on a kb ui those it hosts, and nothing else.
          const hosted =
            surface.host === "ui"
              ? ui.hosted.kernel.contributions(ActionPoint).map(({ id }) => id)
              : [];
          expect(actions.map(({ id }) => id)).toEqual([...registry.map(({ id }) => id), ...hosted]);
          const callable = actions.filter((entry) => listedOn(surface.wire, entry.decision));
          const listed = yield* Effect.promise(() => surface.list());
          // While nothing asks, an action that declares approval is listed even on a wire
          // that cannot carry it, and such a wire need not say it does (WebMCP's hints
          // cannot). GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
          const stated = (entries: readonly ListedAction[]) =>
            surface.wire.carriesApproval ? entries : entries.map(withoutApproval);
          expect({ name, listed: byId(stated(listed)) }).toEqual({
            name,
            listed: byId(stated(callable)),
          });
        }),
      ),
  ],
  [
    "every surface returns the invoke core's receipt for the same call, " +
      "or cannot make a call to an action it does not list",
    (set) =>
      overSurfaces(set, ({ name, surface, core, via }) =>
        Effect.gen(function* () {
          // The screen calls compare against a live tab, not two empty answers.
          const screen = yield* core({ id: "ui.screen", input: {} });
          expect(screen).toMatchObject({
            status: "succeeded",
            output: { tabs: [{ tab: CONTRACT_TAB }] },
          });
          const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
          yield* Effect.forEach(
            CALLS,
            (call) =>
              Effect.gen(function* () {
                const receipt = yield* via(call);
                if (receipt === null) {
                  expect({ name, call, listed: listed.has(call.id) }).toEqual({
                    name,
                    call,
                    listed: false,
                  });
                  return;
                }
                expect({ name, call, receipt: asWireData(receipt) }).toEqual({
                  name,
                  call,
                  receipt: asWireData(yield* core(asMadeOn(surface, call))),
                });
              }),
            { discard: true },
          );
        }),
      ),
  ],
  [
    "every surface that states a session makes a screen command in it, " +
      "not in the most recently active tab",
    (set) =>
      overSurfaces(set, ({ name, surface, ui, via }) =>
        Effect.scoped(
          Effect.gen(function* () {
            if (surface.session !== "stated") return;
            yield* Effect.acquireRelease(FakeTab.open(ui.at, LATER_TAB), (later) => later.close);
            const navigate = { id: "ui.navigate", input: { route: "/graph" } };
            expect({ name, receipt: yield* via({ ...navigate, session: CONTRACT_TAB }) }).toEqual({
              name,
              receipt: {
                status: "succeeded",
                id: navigate.id,
                output: { outcome: "applied", tab: CONTRACT_TAB },
              },
            });
            expect({ name, receipt: yield* via(navigate) }).toEqual({
              name,
              receipt: {
                status: "succeeded",
                id: navigate.id,
                output: { outcome: "applied", tab: LATER_TAB },
              },
            });
          }),
        ),
      ),
  ],
  [
    "every surface that states a session fills what it leaves out from that tab, " +
      "says what it filled, and fills nothing in no session",
    (set) =>
      overSurfaces(set, ({ name, surface, ui, core, via }) =>
        Effect.scoped(
          Effect.gen(function* () {
            if (surface.session !== "stated") return;
            const id = `n.focused-${name}`;
            const added = yield* core({ id: "node.add", input: { id, text: "before" } });
            expect(added.status).toBe("succeeded");
            const focusedOn = {
              ...FAKE_TAB_SCREEN,
              panes: FAKE_TAB_SCREEN.panes.map((pane) => ({ ...pane, focused: id })),
            };
            const tab = `${FOCUS_TAB}.${name}`;
            yield* Effect.acquireRelease(FakeTab.open(ui.at, tab, focusedOn), (open) => open.close);
            const rename = { id: "node.update", input: { text: "renamed here" } };
            const receipt = yield* via({ ...rename, session: tab });
            expect({ name, receipt }).toMatchObject({
              name,
              receipt: {
                status: "succeeded",
                output: { id },
                context: { id: { from: "focused", value: id } },
              },
            });
            expect({ name, receipt: yield* via(rename) }).toMatchObject({
              name,
              receipt: { status: "failed", code: "invalid_input" },
            });
          }),
        ),
      ),
  ],
  [
    "every surface writes an extension's setting on its node as it writes any field, " +
      "and nothing else of that node",
    (set) =>
      overSurfaces(set, ({ name, surface, via }) =>
        Effect.gen(function* () {
          const write = (value: string): ActionRequest => ({
            id: "node.update",
            input: {
              id: EXTENSION_NODE,
              setProps: [{ field: SETTING_FIELD, value: { t: "str", v: value } }],
              unsetProps: [{ field: SETTING_FIELD }],
            },
          });
          const receipt = yield* via(write(name));
          if (receipt === null) {
            // Only a surface that cannot reach the write at all may not make it.
            const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
            expect({ name, listed: listed.has("node.update") }).toEqual({ name, listed: false });
            return;
          }
          // Whoever calls: no policy asks while policies are deferred. GAP [[01M5E2DAVRH5CWKM27BVDYW19T]]
          expect({ name, status: receipt.status }).toEqual({ name, status: "succeeded" });
          // Read back through the surface: the session the contract opened has not seen the write.
          const read = yield* via({ id: "node.get", input: { id: EXTENSION_NODE, depth: 0 } });
          expect({ name, read: read?.status === "succeeded" ? read.output : read }).toMatchObject({
            name,
            read: { node: { text: "Core", props: { [SETTING_FIELD]: [{ t: "str", v: name }] } } },
          });
          // The same node is still write-protected beyond its settings.
          const renamed = yield* via({
            id: "node.update",
            input: { id: EXTENSION_NODE, text: "renamed" },
          });
          expect({ name, code: renamed?.status === "failed" ? renamed.code : "ran" }).toEqual({
            name,
            code: "forbidden",
          });
        }),
      ),
  ],
  [
    "the commit holds every action to the system-write rule: no surface renames, deletes or " +
      "files under a system node without force, whichever action plans the write",
    (set) =>
      overSurfaces(set, ({ name, surface, via }) =>
        Effect.gen(function* () {
          const listed = new Set((yield* Effect.promise(() => surface.list())).map((a) => a.id));
          const writes: readonly ActionRequest[] = [
            { id: "node.update", input: { id: EXTENSION_NODE, text: "renamed" } },
            { id: "node.delete", input: { id: EXTENSION_NODE } },
            { id: "node.addTree", input: { outline: "- filed", parent: EXTENSION_NODE } },
          ];
          for (const write of writes) {
            const receipt = yield* via(write);
            const outcome =
              receipt === null ? "uncallable" : receipt.status === "failed" ? receipt.code : "ran";
            // Only a surface that does not list the action may be unable to make it.
            const uncallable = outcome === "uncallable" && !listed.has(write.id);
            expect({ name, action: write.id, outcome }).toEqual({
              name,
              action: write.id,
              outcome: uncallable ? outcome : "forbidden",
            });
          }
        }),
      ),
  ],
  [
    "no call says who makes it: the wire does, and an actor a call states is dropped, never refused",
    (set) =>
      overSurfaces(set, ({ name, surface }) =>
        Effect.sync(() => {
          const { wire } = surface;
          const claims = {
            id: "node.get",
            input: { id: EXTENSION_NODE },
            actor: wire.actor === "human" ? "agent" : "human",
            approved: true,
            script: { subject: EXTENSION_NODE, grant: {} },
          };
          const stated = requestOf(claims);
          if (!("request" in stated)) throw new Error(stated.invalid);
          expect({ name, request: stated.request }).toEqual({
            name,
            request: { id: claims.id, input: claims.input, approved: true, script: claims.script },
          });
          const made = onWire(wire, stated.request);
          expect({ name, actor: made.actor, script: made.script }).toEqual({
            name,
            // A script's reach makes the call the script's, where the wire relays it.
            actor: wire.relays === true ? "script" : wire.actor,
            script: wire.relays === true ? claims.script : undefined,
          });
          expect({ name, approved: made.approved }).toEqual({
            name,
            approved: wire.carriesApproval ? true : undefined,
          });
          expect({ name, actor: onWire(wire, { id: "node.get", input: {} }).actor }).toEqual({
            name,
            actor: wire.actor,
          });
        }),
      ),
  ],
];

/**
 * Run the contract over every surface at once, once for each way the root's
 * `kb ui` listens.
 *
 * @param set - how a root is served, and each surface's factory by name. The
 *   map is the list of surfaces, so adding a surface means adding an entry,
 *   and it then has to meet every property here.
 */
export function surfaceContract(set: SurfaceSet): void {
  const names = Object.keys(set.surfaces).join(", ");
  for (const listener of Object.values(LISTENER_KINDS)) {
    const run: OnListener = { ...set, listener };
    describe(`action surfaces (${names}) on a ${listener} kb ui — one registry contract`, () => {
      for (const [title, property] of PROPERTIES) test(title, () => property(run));
    });
  }
}
