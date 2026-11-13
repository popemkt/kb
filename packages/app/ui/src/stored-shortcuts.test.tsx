import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { sandboxTrustDef } from "@kb/operations";
import { Effect } from "effect";
import { defineExtension, KeyContextPoint, KeybindingPoint } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { SYSTEM_IDS, present, type KbNode } from "@kb/model";
import { foldSeed, systemSeedNodes } from "@kb/seed";
import {
  keyboardNodes,
  keyboardSchemaNodes,
  chordToText,
  keyTargetNodeId,
  SHORTCUT_IDS,
  shortcutGroupId,
  type Chord,
  type KeyboardDefinition,
} from "@kb/keybindings";
import {
  CommandPoint,
  OverlayPoint,
  currentContributions,
  currentKeymap,
  setToastSink,
  uiKernelReader,
  syncUiPlugins,
} from "@kb/ui-sdk";
import { ontologyWire } from "@/test-support/ontology-wire";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { useGraphStore } from "@/stores/graph.store";
import { setPostAction } from "@/api/action";
import { loadManifest } from "@/lib/manifest";
import { currentRow, confirmShortcut, readShortcutApproval } from "@/lib/stored-shortcuts";
import { storedShortcutsUiPlugin } from "@/stored-shortcuts";
import { useUiStore } from "@/stores/ui.store";
import { pageCommandContext } from "@/stores/page-commands";

const at = "2026-11-12T00:00:00Z";
const definition: KeyboardDefinition =
  defineExtension({
    name: "trial",
    label: "Trial",
    keyboard: {
      contexts: [
        {
          id: "editing",
          value: { reach: "surface", intents: ["first", "second"], reserved: [{ key: "Escape" }] },
        },
      ],
      bindings: [
        {
          id: "enter",
          value: {
            context: "trial.editing",
            chord: { key: "Enter", mod: false },
            run: { intent: "first" },
          },
        },
      ],
    },
  }).keyboard ?? {};
const native = definePlugin({
  name: "trial",
  apply: (ctx) =>
    Effect.gen(function* () {
      for (const entry of definition.contexts ?? []) yield* ctx.contribute(KeyContextPoint, entry);
      for (const entry of definition.bindings ?? []) yield* ctx.contribute(KeybindingPoint, entry);
    }),
});
const ref = (v: string) => ({ t: "ref" as const, v });
function row(id: string, chord: Chord, replaces?: string): KbNode[] {
  return [
    {
      id,
      text: "My shortcut",
      children: [],
      createdAt: at,
      updatedAt: at,
      props: {
        [SYSTEM_IDS.typeField]: [ref(SHORTCUT_IDS.tag)],
        [SHORTCUT_IDS.keys]: [{ t: "str", v: chordToText(chord) }],
        [SHORTCUT_IDS.where]: [{ t: "str", v: "trial.editing" }],
        [SHORTCUT_IDS.runs]: [ref(keyTargetNodeId("trial", "trial.editing", { intent: "second" }))],
        [SHORTCUT_IDS.enabled]: [{ t: "bool", v: true }],
        ...(replaces === undefined ? {} : { [SHORTCUT_IDS.replaces]: [ref(replaces)] }),
      },
    },
  ];
}
function editedKeys(id: string, chord: Chord): KbNode {
  const existing = present(
    useGraphStore.getState().wireNodes.find((node) => node.id === id),
    "shortcut row",
  );
  return {
    ...existing,
    props: { ...existing.props, [SHORTCUT_IDS.keys]: [{ t: "str", v: chordToText(chord) }] },
  };
}
function hydrate(rows: KbNode[]) {
  useGraphStore.getState().hydrateFromWire(
    [
      ...foldSeed(
        [
          {
            name: "trial",
            label: "Trial",
            seed: (stamp) => [
              ...systemSeedNodes(stamp),
              ...keyboardSchemaNodes(stamp),
              ...keyboardNodes("trial", definition, stamp),
            ],
          },
        ],
        at,
      ).nodes,
      ...rows,
    ],
    10,
    "api",
  );
}
const notices: string[] = [];
let trusted: string[];
let calls: string[];
let manifestFails: boolean;
async function manifest() {
  await loadManifest();
}
const read = () => currentKeymap("trial.editing");
const press = (key: string) => read().resolve({ key });

beforeEach(async () => {
  setToastSink((message) => notices.push(message));
  notices.length = 0;
  trusted = [];
  calls = [];
  manifestFails = false;
  setPostAction(async (request) => {
    calls.push(request.id);
    if (request.id === "kb.manifest" && manifestFails)
      return {
        id: request.id,
        status: "failed",
        code: "internal",
        message: "Approval ledger unavailable",
      };
    if (request.id === "sandbox.trust")
      trusted.push(sandboxTrustDef.inputSchema.parse(request.input).digest);
    const output =
      request.id === "kb.manifest"
        ? { root: "/trial", trusted, actions: [], views: [], extensions: [] }
        : request.id === "graph.changes"
          ? {
              head: 10,
              through: 10,
              complete: true,
              changes: [
                {
                  rev: 10,
                  at,
                  actor: "agent",
                  via: "plugin.example",
                  wrote: [{ id: "override", text: "My shortcut", tags: [] }],
                  deleted: [],
                },
              ],
            }
          : {};
    return { id: request.id, status: "succeeded", output, rev: 10 };
  });
  await manifest();
});
afterEach(() => {
  syncUiPlugins([]);
  expect(notices.filter((message) => message.startsWith("UI plugin"))).toEqual([]);
  setPostAction(null);
});

describe("stored shortcuts through the real page keyboard point", () => {
  it("admits a free row, follows edits under an ontology scope, and withdraws on unload", () => {
    hydrate([...row("free", { key: "x", mod: false }), ...ontologyWire()]);
    syncPagePlugins([native, storedShortcutsUiPlugin]);
    expect(press("x")?.value.run).toEqual({ intent: "second" });
    expect(currentRow("free")?.state).toBe("active");
    useGraphStore.getState().setOntologyScope("o.1");
    expect(useGraphStore.getState().ontologyId).toBe("o.1");
    const changed = editedKeys("free", { key: "y", mod: false });
    useGraphStore.getState().applyTx([changed], []);
    expect(press("x")).toBeUndefined();
    expect(press("y")?.value.run).toEqual({ intent: "second" });
    syncPagePlugins([native]);
    expect(press("y")).toBeUndefined();
    expect(press("Enter")?.value.run).toEqual({ intent: "first" });
  });
  it("leaves every override pending regardless of writer, then admits only the confirmed content", async () => {
    hydrate(
      row(
        "override",
        { key: "Enter", mod: false },
        shortcutGroupId(
          "trial",
          "trial.editing",
          keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
        ),
      ),
    );
    syncPagePlugins([native, storedShortcutsUiPlugin]);
    expect(currentRow("override")?.state).toBe("pending");
    expect(press("Enter")?.value.run).toEqual({ intent: "first" });
    const digest = currentRow("override")?.digest;
    if (digest === undefined || digest === null) throw new Error("no confirmation key");
    const review = await readShortcutApproval(digest);
    expect(review?.approveLabel).toBe("Confirm this override");
    expect(renderToStaticMarkup(review?.content)).toContain(
      "Enter in trial editing: Second instead of First",
    );
    expect(renderToStaticMarkup(review?.content)).toContain("<summary");
    expect(renderToStaticMarkup(review?.content)).toContain("Details");
    expect(renderToStaticMarkup(review?.content)).toContain("agent");
    expect(renderToStaticMarkup(review?.content)).toContain("plugin.example");
    expect(calls).not.toContain("sandbox.trust");
    trusted = [digest];
    await manifest();
    expect(currentRow("override")?.state).toBe("active");
    expect(press("Enter")?.value.run).toEqual({ intent: "second" });
    useGraphStore
      .getState()
      .applyTx([editedKeys("override", { key: "Enter", mod: false, alt: false })], []);
    expect(currentRow("override")?.state).toBe("pending");
    expect(press("Enter")?.value.run).toEqual({ intent: "first" });
  });
  it("retains confirmation across label edits and disable/re-enable, and revokes it live", async () => {
    const rows = row(
      "override",
      { key: "Enter", mod: false },
      shortcutGroupId(
        "trial",
        "trial.editing",
        keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
      ),
    );
    hydrate(rows);
    syncPagePlugins([native, storedShortcutsUiPlugin]);
    const digest = currentRow("override")?.digest;
    if (digest === undefined || digest === null) throw new Error("no key");
    trusted = [digest];
    await manifest();
    const original = present(rows[0], "shortcut node");
    const renamed = { ...original, text: "Person's label" };
    useGraphStore.getState().applyTx([renamed], []);
    expect(currentRow("override")?.state).toBe("active");
    useGraphStore.getState().applyTx(
      [
        {
          ...renamed,
          props: { ...renamed.props, [SHORTCUT_IDS.enabled]: [{ t: "bool", v: false }] },
        },
      ],
      [],
    );
    expect(press("Enter")?.value.run).toEqual({ intent: "first" });
    useGraphStore.getState().applyTx([renamed], []);
    expect(currentRow("override")?.state).toBe("active");
    trusted = [];
    await manifest();
    expect(currentRow("override")?.state).toBe("pending");
    expect(press("Enter")?.value.run).toEqual({ intent: "first" });
  });
  it("cannot confirm its way past Escape or a conflicting free chord", async () => {
    hydrate([
      ...row(
        "escape",
        { physicalKey: "Escape" },
        shortcutGroupId(
          "trial",
          "trial.editing",
          keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
        ),
      ),
      ...row("conflict", { key: "Enter", mod: false }),
    ]);
    syncPagePlugins([native, storedShortcutsUiPlugin]);
    const digest = currentRow("escape")?.digest;
    if (digest === undefined || digest === null) throw new Error("no key");
    trusted = [digest];
    await manifest();
    expect(press("Escape")).toBeUndefined();
    expect(currentRow("escape")?.state).toBe("refused");
    expect(currentRow("conflict")?.state).toBe("refused");
  });
  it("offers the pending override's confirmation through the ordinary node menu", () => {
    hydrate(
      row(
        "override",
        { key: "Enter", mod: false },
        shortcutGroupId(
          "trial",
          "trial.editing",
          keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
        ),
      ),
    );
    syncPagePlugins([native, storedShortcutsUiPlugin]);
    expect(uiKernelReader.plugins().find(({ name }) => name === "host")).toMatchObject({
      applied: true,
    });
    expect(currentContributions(CommandPoint).map(({ id, value }) => [id, value.id])).toEqual(
      expect.arrayContaining([["shortcut.review", "shortcut.review"]]),
    );
    const review = currentContributions(CommandPoint).find(
      ({ value }) => value.id === "shortcut.review",
    )?.value;
    const context = pageCommandContext(
      { nodeId: "override", frameId: null },
      { close: () => {}, openStep: () => {} },
    );
    expect(review?.when?.(context)).toBe(true);
  });
});

it("rebuilds a reversed replacement chain and follows native holder unload/reload", async () => {
  hydrate(
    [
      ...row("C", { key: "Enter", mod: false }, "B"),
      ...row(
        "B",
        { key: "Enter", mod: false },
        shortcutGroupId(
          "trial",
          "trial.editing",
          keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
        ),
      ),
    ].toReversed(),
  );
  syncPagePlugins([native, storedShortcutsUiPlugin]);
  const b = currentRow("B");
  const c = currentRow("C");
  if (
    b?.digest === null ||
    b?.digest === undefined ||
    c?.digest === null ||
    c?.digest === undefined
  )
    throw new Error("missing chain");
  trusted = [c.digest];
  await manifest();
  expect(press("Enter")?.value.run).toEqual({ intent: "first" });
  trusted = [c.digest, b.digest];
  await manifest();
  expect(press("Enter")?.id).toBe(c.candidate.contributions[0]?.id);
  syncPagePlugins([storedShortcutsUiPlugin]);
  expect(press("Enter")).toBeUndefined();
  syncPagePlugins([storedShortcutsUiPlugin, native]);
  expect(press("Enter")?.id).toBe(c.candidate.contributions[0]?.id);
});

it("uses actual page-only command membership and re-reads context eligibility without a shortcut edit", () => {
  let available = false;
  const commands = definePlugin({
    name: "page-only",
    apply: (ctx) =>
      Effect.gen(function* () {
        yield* ctx.contribute(CommandPoint, {
          id: "first",
          value: {
            id: "page.only",
            menu: { where: "global" },
            when: () => available,
            run: () => {},
          },
        });
        yield* ctx.contribute(CommandPoint, {
          id: "second",
          value: { id: "page.only", menu: { where: "global" }, run: () => {} },
        });
      }),
  });
  const rows = row("command", { key: "z", mod: false });
  const node = present(rows[0], "shortcut node");
  rows[0] = { ...node, props: { ...node.props, [SHORTCUT_IDS.runs]: [ref("page.only")] } };
  hydrate([
    ...rows,
    {
      id: "page.only",
      text: "Writable description",
      children: [],
      props: { [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.command)] },
      createdAt: at,
      updatedAt: at,
    },
  ]);
  syncPagePlugins([native, commands, storedShortcutsUiPlugin]);
  // The eligible second duplicate must not authenticate a different first runner entry.
  expect(press("z")).toBeUndefined();
  available = true;
  useUiStore.getState().setNodePaletteOpen(true);
  expect(press("z")?.value.run).toEqual({ command: "page.only" });
  syncPagePlugins([native, storedShortcutsUiPlugin]);
  expect(press("z")).toBeUndefined();
  syncPagePlugins([native, commands, storedShortcutsUiPlugin]);
  expect(press("z")?.value.run).toEqual({ command: "page.only" });
});

it("rejects an old answer after content changes, while missing writer history remains pending", async () => {
  hydrate(
    row(
      "override",
      { key: "Enter", mod: false },
      shortcutGroupId(
        "trial",
        "trial.editing",
        keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
      ),
    ),
  );
  syncPagePlugins([native, storedShortcutsUiPlugin]);
  const reviewed = currentRow("override");
  if (reviewed === undefined || reviewed.digest === null) throw new Error("missing review");
  useGraphStore
    .getState()
    .applyTx([editedKeys("override", { key: "Enter", mod: false, shift: false })], []);
  await expect(confirmShortcut(reviewed)).rejects.toThrow("changed");
  expect(calls).not.toContain("sandbox.trust");
  expect(currentRow("override")?.state).toBe("pending");
  setPostAction(async ({ id }) => ({
    id,
    status: "failed",
    code: "internal",
    message: "History unavailable",
  }));
  const current = currentRow("override");
  if (current?.digest === null || current?.digest === undefined)
    throw new Error("no current digest");
  expect(await readShortcutApproval(current.digest)).not.toBeNull();
  expect(currentRow("override")?.state).toBe("pending");
});

it("a person's confirmation uses the existing trust action and immediately updates admission", async () => {
  hydrate(
    row(
      "override",
      { key: "Enter", mod: false },
      shortcutGroupId(
        "trial",
        "trial.editing",
        keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
      ),
    ),
  );
  syncPagePlugins([native, storedShortcutsUiPlugin]);
  const reviewed = currentRow("override");
  if (reviewed === undefined) throw new Error("missing review");
  expect(calls).not.toContain("sandbox.trust");
  await confirmShortcut(reviewed);
  expect(calls.filter((id) => id === "sandbox.trust")).toHaveLength(1);
  expect(press("Enter")?.value.run).toEqual({ intent: "second" });
});

it("shows exact content in the ordinary approval dialog and requires a fresh click after an edit", async () => {
  const dom = new Window({ url: "http://localhost/" });
  const globals = globalThis as Record<string, unknown>;
  const names = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const old = names.map((name) => globals[name]);
  Object.assign(globals, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.document.createElement("div") as unknown as HTMLDivElement;
  dom.document.body.appendChild(container as unknown as never);
  const root = createRoot(container);
  try {
    hydrate(
      row(
        "override",
        { key: "Enter", mod: false },
        shortcutGroupId(
          "trial",
          "trial.editing",
          keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
        ),
      ),
    );
    syncPagePlugins([native, storedShortcutsUiPlugin]);
    const overlay = currentContributions(OverlayPoint).find(
      ({ id }) => id === "shortcut-review",
    )?.value;
    const review = currentContributions(CommandPoint).find(
      ({ value }) => value.id === "shortcut.review",
    )?.value;
    if (overlay === undefined || review === undefined) throw new Error("missing review surface");
    const Overlay = overlay.Component;
    const context = pageCommandContext(
      { nodeId: "override", frameId: null },
      { close: () => {}, openStep: () => {} },
    );
    const button = (label: string) => {
      const found = [...container.querySelectorAll("button")].find(
        (element) => element.textContent === label,
      );
      if (found === undefined) throw new Error(`missing ${label}`);
      return found;
    };
    await act(async () => root.render(<Overlay />));
    await act(async () => {
      await review.run(context);
    });
    expect(container.textContent).toContain("kb.shortcut.confirmation.v2");
    expect(container.textContent).toContain("plugin.example");
    expect(button("Confirm this override").disabled).toBe(false);
    await act(async () =>
      useGraphStore
        .getState()
        .applyTx([editedKeys("override", { key: "Enter", mod: false, alt: false })], []),
    );
    await act(async () => button("Confirm this override").click());
    expect(container.textContent).toContain("This shortcut changed");
    expect(calls).not.toContain("sandbox.trust");
    await act(async () => button("Decline").click());
    await act(async () => {
      await review.run(context);
    });
    await act(async () => button("Confirm this override").click());
    expect(calls.filter((id) => id === "sandbox.trust")).toHaveLength(1);
    expect(press("Enter")?.value.run).toEqual({ intent: "second" });
  } finally {
    act(() => root.unmount());
    container.remove();
    await dom.happyDOM.close();
    for (const [i, name] of names.entries()) globals[name] = old[i];
  }
});

it("withdraws confirmation while its refreshed ledger cannot be read and recovers from a fresh read", async () => {
  hydrate(
    row(
      "override",
      { key: "Enter", mod: false },
      shortcutGroupId(
        "trial",
        "trial.editing",
        keyTargetNodeId("trial", "trial.editing", { intent: "first" }),
      ),
    ),
  );
  syncPagePlugins([native, storedShortcutsUiPlugin]);
  const digest = currentRow("override")?.digest;
  if (digest === null || digest === undefined) throw new Error("missing digest");
  trusted = [digest];
  await manifest();
  expect(currentRow("override")?.state).toBe("active");
  manifestFails = true;
  await manifest();
  expect(currentRow("override")?.state).toBe("pending");
  expect(press("Enter")?.value.run).toEqual({ intent: "first" });
  manifestFails = false;
  await manifest();
  expect(currentRow("override")?.state).toBe("active");
});

it("publishes alternate keys from one row and withdraws every component together", () => {
  const original = present(row("alternates", { key: "x", mod: false })[0], "shortcut row");
  const alternate = {
    ...original,
    props: {
      ...original.props,
      [SHORTCUT_IDS.keys]: [
        { t: "str" as const, v: chordToText({ key: "x", mod: false }) },
        { t: "str" as const, v: chordToText({ key: "y", mod: false }) },
      ],
    },
  };
  hydrate([alternate]);
  syncPagePlugins([native, storedShortcutsUiPlugin]);
  expect(currentRow("alternates")?.candidate.contributions).toHaveLength(2);
  expect(press("x")?.value.run).toEqual({ intent: "second" });
  expect(press("y")?.value.run).toEqual({ intent: "second" });
  useGraphStore.getState().applyTx(
    [
      {
        ...alternate,
        props: { ...alternate.props, [SHORTCUT_IDS.enabled]: [{ t: "bool", v: false }] },
      },
    ],
    [],
  );
  expect(press("x")).toBeUndefined();
  expect(press("y")).toBeUndefined();
  useGraphStore.getState().applyTx([alternate], []);
  expect(press("x")?.value.run).toEqual({ intent: "second" });
  expect(press("y")?.value.run).toEqual({ intent: "second" });
  syncPagePlugins([native]);
  expect(press("x")).toBeUndefined();
  expect(press("y")).toBeUndefined();
});
