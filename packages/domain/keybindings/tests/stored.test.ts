import { describe, expect, test } from "bun:test";
import {
  SYSTEM_IDS,
  foldSeed,
  systemSeedNodes,
  seededCommand,
  type KbNode,
  type NodeLike,
  type PropValue,
} from "@kb/model";
import type { Contribution, ContributionEntry } from "@kb/plugin";
import {
  admitKeymaps,
  keyContextOf,
  type Keybinding,
  type KeyContextSpec,
  type KeyboardDefinition,
} from "../src/bindings.ts";
import { PALETTE_CHORD, type Chord } from "../src/chord.ts";
import {
  keyboardNodes,
  keyboardOptions,
  keyboardSchemaNodes,
  chordNode,
  callNode,
  keyContextNodeId,
  keyTargetNodeId,
  shortcutNodeId,
  SHORTCUT_IDS,
} from "../src/nodes.ts";
import { storedKeybindings, STORED_KEY_OWNER, type KeyboardRegistrations } from "../src/stored.ts";

const at = "2026-11-11T00:00:00.000Z";
const core: KeyboardDefinition = {
  contexts: [
    {
      id: "page",
      value: {
        reach: "page",
        intents: ["palette", "split", "unbound"],
        reserved: [{ mod: false }, PALETTE_CHORD],
      },
    },
  ],
  bindings: [
    {
      id: "page.palette",
      value: { context: "core.page", chord: PALETTE_CHORD, run: { intent: "palette" } },
    },
    {
      id: "go",
      value: { context: "core.page", chord: { key: "g", mod: true }, run: { command: "core.go" } },
    },
    {
      id: "other",
      value: {
        context: "core.page",
        chord: { key: "h", mod: true },
        run: { command: "core.other" },
      },
    },
  ],
};
const outline: KeyboardDefinition = {
  contexts: [
    {
      id: "editing",
      value: { reach: "surface", intents: ["split"], reserved: [{ key: "Escape" }] },
    },
  ],
  bindings: [
    {
      id: "editing.split",
      value: {
        context: "outline.editing",
        chord: { key: "Enter", mod: false },
        run: { intent: "split" },
      },
    },
    {
      id: "editing.numpad",
      value: {
        context: "outline.editing",
        chord: { code: "NumpadEnter", mod: false },
        run: { intent: "split" },
      },
    },
  ],
};
function contributed<T>(
  family: string,
  entries: readonly ContributionEntry<T>[] = [],
): Contribution<T>[] {
  return entries.map(({ id, value }) => ({
    id: `${family}.${id}`,
    owner: family,
    aliases: [],
    value,
  }));
}
const registrations: KeyboardRegistrations = {
  contexts: [
    ...contributed<KeyContextSpec>("core", core.contexts),
    ...contributed<KeyContextSpec>("outline", outline.contexts),
  ].map(keyContextOf),
  bindings: [
    ...contributed<Keybinding>("core", core.bindings),
    ...contributed<Keybinding>("outline", outline.bindings),
  ],
  source: (owner) => ({ provider: owner, implementation: `${owner}:version-1` }),
  command: (id) =>
    ["core.go", "core.other", "core.unbound"].includes(id)
      ? { id, source: { provider: "core", implementation: "core:version-1" } }
      : undefined,
  action: (id) =>
    ["node.update", "test.unbound"].includes(id)
      ? { id, source: { provider: "core", implementation: "core:version-1" } }
      : undefined,
};
const seed = foldSeed(
  [
    {
      name: "core",
      label: "Core",
      seed: (stamp: string) => [
        ...systemSeedNodes(stamp),
        ...keyboardSchemaNodes(stamp),
        ...["core.go", "core.other", "core.unbound"].map((id) => seededCommand(id, id, stamp)),
        ...keyboardNodes("core", core, stamp),
      ],
      declaredOptions: keyboardOptions("core", core),
    },
    {
      name: "outline",
      label: "Outline",
      seed: (stamp: string) => keyboardNodes("outline", outline, stamp),
      declaredOptions: keyboardOptions("outline", outline),
    },
  ],
  at,
).nodes;
const targetId = (id: string) =>
  id === "outline.editing.split" ? keyTargetNodeId("", "outline.editing", { intent: "split" }) : id;
const ref = (v: string): PropValue => ({ t: "ref", v });
function shortcut(
  id: string,
  chord: Chord,
  options: {
    context?: string;
    target?: string;
    replaces?: string;
    tag?: string;
    props?: Record<string, PropValue[]>;
  } = {},
): KbNode[] {
  const key = chordNode(`${id}.keys`, chord, at);
  return [
    key,
    {
      id,
      text: `Shortcut ${id}`,
      props: {
        [SYSTEM_IDS.typeField]: [ref(options.tag ?? SHORTCUT_IDS.tag)],
        [SHORTCUT_IDS.keys]: [ref(key.id)],
        [SHORTCUT_IDS.runs]: [ref(targetId(options.target ?? "core.other"))],
        [SHORTCUT_IDS.where]: [ref(keyContextNodeId(options.context ?? "core.page"))],
        [SHORTCUT_IDS.enabled]: [{ t: "bool", v: true }],
        ...(options.replaces === undefined
          ? {}
          : { [SHORTCUT_IDS.replaces]: [ref(options.replaces)] }),
        ...options.props,
      },
      children: [],
      createdAt: at,
      updatedAt: at,
    },
  ];
}
function election(
  nodes: readonly NodeLike[],
  granted: ReadonlySet<string> | "all" = new Set(),
  held = registrations,
) {
  const reading = storedKeybindings(nodes, held);
  const maps = admitKeymaps(
    held.contexts,
    [...held.bindings, ...reading.candidates.map(({ contribution }) => contribution)],
    (_owner, binding) => {
      const candidate = reading.candidates.find(({ contribution }) => contribution === binding);
      return candidate === undefined || granted === "all" || granted.has(candidate.review);
    },
  );
  return { reading, maps };
}
function switchOff(nodes: readonly KbNode[], id: string): KbNode[] {
  return nodes.map((node) =>
    node.id === id
      ? {
          ...node,
          props: { ...node.props, [SHORTCUT_IDS.enabled]: [{ t: "bool" as const, v: false }] },
        }
      : node,
  );
}

describe("stored shortcut identities", () => {
  test("ordinary and inherited rows add free chords without borrowing graph provenance", () => {
    const inherited: KbNode = {
      id: "my.tag",
      text: "My shortcut tag",
      props: { [SYSTEM_IDS.extendsField]: [ref(SHORTCUT_IDS.tag)] },
      children: [],
      createdAt: at,
      updatedAt: at,
    };
    const rows = shortcut(
      "my.key",
      { key: "p", mod: true },
      {
        tag: inherited.id,
        props: { owner: [{ t: "str", v: "core" }], family: [ref("sys.extension.core")] },
      },
    );
    const { reading, maps } = election([...seed, inherited, ...rows]);
    expect(reading.refused).toEqual([]);
    expect(reading.candidates[0]?.contribution.owner).toBe(`${STORED_KEY_OWNER}/my.key`);
    expect(maps.get("core.page")?.resolve({ key: "p", ctrlKey: true })?.value.run).toEqual({
      command: "core.other",
    });
  });

  test.each([
    { chord: { code: "KeyA", mod: false }, context: "core.page" },
    { chord: { code: "KeyK", mod: true }, context: "core.page" },
    { chord: { code: "Escape" }, context: "outline.editing" },
  ])(
    "writable family and owner fields cannot take reserved $context presses",
    ({ chord, context }) => {
      const { reading, maps } = election(
        [
          ...seed,
          ...shortcut("forged", chord, {
            context,
            props: { owner: [{ t: "str", v: "core" }], family: [ref("sys.extension.outline")] },
          }),
        ],
        "all",
      );
      expect(reading.candidates).toHaveLength(1);
      expect(maps.get(context)?.refused[0]?.reason).toContain("reserved");
    },
  );

  test("a target's intent belongs to its context even when another context names that intent", () => {
    const { reading } = election([
      ...seed,
      ...shortcut("wrong.context", { key: "p", mod: true }, { target: "outline.editing.split" }),
    ]);
    expect(reading.candidates).toHaveLength(0);
    expect(reading.refused[0]?.reason).toContain("another context");
  });

  test("forged or unloaded targets are inert, and returning a registration is a fresh read", () => {
    const nodes = [...seed, ...shortcut("my.key", { key: "p", mod: true })];
    const initial = storedKeybindings(nodes, registrations);
    const absent = {
      ...registrations,
      command: (id: string) => (id === "core.other" ? undefined : registrations.command(id)),
    };
    expect(storedKeybindings(nodes, absent).candidates).toHaveLength(0);
    expect(
      storedKeybindings(nodes, { ...registrations, source: () => undefined }).candidates,
    ).toHaveLength(0);
    expect(
      storedKeybindings(
        nodes.filter(({ id }) => id !== "core.other"),
        registrations,
      ).candidates,
    ).toHaveLength(0);
    expect(storedKeybindings(nodes, registrations)).toEqual(initial);
    expect(
      storedKeybindings(
        [...seed, ...shortcut("forged", { key: "p", mod: true }, { target: "invented.target" })],
        registrations,
      ).candidates,
    ).toHaveLength(0);
  });
});

describe("stored replacement ordering and authority", () => {
  test("approval names exact content, and disabling an override reveals its holder", () => {
    const nodes = [
      ...seed,
      ...shortcut("override", { key: "g", mod: true }, { replaces: shortcutNodeId("core.go") }),
    ];
    const waiting = election(nodes);
    expect(waiting.maps.get("core.page")?.resolve({ key: "g", ctrlKey: true })?.id).toBe("core.go");
    const granted = new Set(waiting.reading.candidates.map(({ review }) => review));
    expect(
      election(nodes, granted).maps.get("core.page")?.resolve({ key: "g", ctrlKey: true })?.owner,
    ).toBe(`${STORED_KEY_OWNER}/override`);
    expect(
      election(switchOff(nodes, "override"), granted)
        .maps.get("core.page")
        ?.resolve({ key: "g", ctrlKey: true })?.id,
    ).toBe("core.go");
    expect(election(nodes, granted).reading.candidates[0]?.review).toBe(
      waiting.reading.candidates[0]?.review,
    );
  });

  test("dependency order survives reverse enumeration, a disabled intermediate holder, and target unload/reload", () => {
    const nodes = [
      ...seed,
      ...shortcut("C", { key: "g", mod: true }, { target: "core.go", replaces: "B" }),
      ...shortcut(
        "B",
        { key: "g", mod: true },
        { target: "core.other", replaces: shortcutNodeId("core.go") },
      ),
    ];
    const reading = storedKeybindings(nodes, registrations);
    expect(reading.candidates.map(({ nodeId }) => nodeId)).toEqual(["B", "C"]);
    expect(storedKeybindings(nodes.toReversed(), registrations)).toEqual(reading);
    const winner = (rows: readonly NodeLike[], held = registrations) =>
      election(rows, "all", held).maps.get("core.page")?.resolve({ key: "g", ctrlKey: true });
    expect(winner(nodes)?.owner).toBe(`${STORED_KEY_OWNER}/C`);
    expect(winner(switchOff(nodes, "B"))?.id).toBe("core.go");
    expect(
      winner(nodes, {
        ...registrations,
        command: (id: string) => (id === "core.other" ? undefined : registrations.command(id)),
      })?.id,
    ).toBe("core.go");
    expect(winner(nodes)?.owner).toBe(`${STORED_KEY_OWNER}/C`);
  });

  test("cycles, their dependents and dangling replacements remain inert", () => {
    const nodes = [
      ...seed,
      ...shortcut("A", { key: "g", mod: true }, { replaces: "B" }),
      ...shortcut("B", { key: "g", mod: true }, { replaces: "A" }),
      ...shortcut("C", { key: "g", mod: true }, { replaces: "A" }),
      ...shortcut("D", { key: "g", mod: true }, { replaces: "absent" }),
    ];
    const { reading, maps } = election(nodes, "all");
    expect(reading.refused.map(({ id }) => id)).toEqual(["D"]);
    expect(maps.get("core.page")?.resolve({ key: "g", ctrlKey: true })?.id).toBe("core.go");
    expect(maps.get("core.page")?.refused).toHaveLength(3);
  });

  test("distinct actor-neutral rows cannot implicitly take one another's physical slot", () => {
    const nodes = [
      ...seed,
      ...shortcut(
        "A",
        { key: "u", mod: false },
        { context: "outline.editing", target: "outline.editing.split" },
      ),
      ...shortcut(
        "B",
        { code: "KeyU", mod: false },
        {
          context: "outline.editing",
          target: "outline.editing.split",
          props: { author: [{ t: "str", v: "person" }] },
        },
      ),
    ];
    const { maps } = election(nodes, "all");
    expect(maps.get("outline.editing")?.resolve({ key: "u", code: "KeyU" })?.owner).toBe(
      `${STORED_KEY_OWNER}/A`,
    );
    expect(maps.get("outline.editing")?.refused).toHaveLength(1);
  });

  test("an approved physical replacement inherits its holder's priority over the character fallback", () => {
    const nodes = [
      ...seed,
      ...shortcut(
        "replace.numpad",
        { code: "NumpadEnter", mod: false },
        {
          context: "outline.editing",
          target: "outline.editing.split",
          replaces: shortcutNodeId("outline.editing.numpad"),
        },
      ),
    ];
    const { maps } = election(nodes, "all");
    expect(maps.get("outline.editing")?.resolve({ key: "Enter", code: "NumpadEnter" })?.owner).toBe(
      `${STORED_KEY_OWNER}/replace.numpad`,
    );
    expect(maps.get("outline.editing")?.resolve({ key: "Enter", code: "Enter" })?.id).toBe(
      "outline.editing.split",
    );
    expect(
      election(nodes).maps.get("outline.editing")?.resolve({ key: "Enter", code: "NumpadEnter" })
        ?.id,
    ).toBe("outline.editing.numpad");
  });
});

test("review identity includes full resolved inputs, code identity and every chord constraint, not labels", () => {
  const call = callNode(
    "my.recipe",
    { action: "node.update", input: { text: "first", nested: { a: 1, b: 2 } } },
    at,
  );
  const nodes = [
    ...seed,
    call,
    ...shortcut("my.call", { code: "KeyP", mod: true, alt: false }, { target: call.id }),
  ];
  const review = storedKeybindings(nodes, registrations).candidates[0]?.review;
  expect(review).toBeDefined();
  expect(
    storedKeybindings(
      nodes.map((node) => ({ ...node, text: "A cosmetic edit" })),
      registrations,
    ).candidates[0]?.review,
  ).toBe(review);
  const changed = callNode(
    call.id,
    { action: "node.update", input: { text: "second", nested: { a: 1, b: 2 } } },
    at,
  );
  expect(
    storedKeybindings(
      nodes.map((node) => (node.id === call.id ? changed : node)),
      registrations,
    ).candidates[0]?.review,
  ).not.toBe(review);
  expect(
    storedKeybindings(nodes, {
      ...registrations,
      action: (id) => ({ id, source: { provider: "core", implementation: "changed-code" } }),
    }).candidates[0]?.review,
  ).not.toBe(review);
  const keyChanged = nodes.map((node) =>
    node.id === "my.call.keys" ? chordNode(node.id, { code: "KeyP", mod: true }, at) : node,
  );
  expect(storedKeybindings(keyChanged, registrations).candidates[0]?.review).not.toBe(review);
});

test("unbound registered intents, commands and action recipes are addressable without a default binding", () => {
  const intent = keyTargetNodeId("", "core.page", { intent: "unbound" });
  const recipe = callNode(
    "call.unbound",
    { action: "test.unbound", input: { chosen: [1, false] } },
    at,
  );
  const nodes = [
    ...seed,
    recipe,
    ...shortcut("unbound.intent", { key: "u", mod: true }, { target: intent }),
    ...shortcut("unbound.command", { key: "c", mod: true }, { target: "core.unbound" }),
    ...shortcut("unbound.action", { key: "a", mod: true }, { target: recipe.id }),
  ];
  const reading = storedKeybindings(nodes, registrations);
  expect(reading.refused).toEqual([]);
  expect(reading.candidates.map(({ contribution }) => contribution.value.run)).toEqual([
    { action: "test.unbound", input: { chosen: [1, false] } },
    { command: "core.unbound" },
    { intent: "unbound" },
  ]);
});

test("a description never manufactures a command registration or authenticates a page-only source", () => {
  const forged = {
    children: [],
    createdAt: at,
    updatedAt: at,
    id: "forged.command",
    text: "Core command",
    props: {
      [SYSTEM_IDS.typeField]: [ref(SYSTEM_IDS.command)],
      owner: [ref("sys.extension.core")],
    },
  };
  const nodes = [
    ...seed,
    forged,
    ...shortcut("forged.key", { key: "z", mod: true }, { target: forged.id }),
  ];
  const absent = storedKeybindings(nodes, registrations);
  expect(absent.candidates).toEqual([]);
  expect(absent.refused[0]?.reason).toContain("unavailable or unsupported");
  // A live adapter supplies only entries whose code identity the authority host authenticates.
  const pageOnly = { ...registrations, command: () => undefined };
  expect(
    storedKeybindings([...seed, ...shortcut("page.only", { key: "z", mod: true })], pageOnly)
      .candidates,
  ).toEqual([]);
});

test("command eligibility and implementation changes reconsider unchanged graph rows", () => {
  const nodes = [...seed, ...shortcut("conditional", { key: "x", mod: true })];
  const initial = storedKeybindings(nodes, registrations);
  expect(initial.candidates).toHaveLength(1);
  expect(
    storedKeybindings(nodes, { ...registrations, command: () => undefined }).candidates,
  ).toEqual([]);
  expect(storedKeybindings(nodes, registrations)).toEqual(initial);
  const replacement = storedKeybindings(nodes, {
    ...registrations,
    command: (id) => ({
      id,
      source: { provider: "other", implementation: "changed-implementation" },
    }),
  });
  expect(replacement.candidates[0]?.review).not.toBe(initial.candidates[0]?.review);
});

test("replacement reviews cover native holder semantics and the whole stored dependency chain", () => {
  const nodes = [
    ...seed,
    ...shortcut("B", { key: "g", mod: true }, { replaces: shortcutNodeId("core.go") }),
    ...shortcut("C", { key: "g", mod: true }, { replaces: "B" }),
  ];
  const initial = storedKeybindings(nodes, registrations);
  const changed = storedKeybindings(nodes, {
    ...registrations,
    bindings: registrations.bindings.map((binding) =>
      binding.id === "core.go"
        ? { ...binding, value: { ...binding.value, run: { command: "core.other" } } }
        : binding,
    ),
  });
  expect(changed.candidates.map(({ review }) => review)).not.toEqual(
    initial.candidates.map(({ review }) => review),
  );
  expect(changed.candidates[1]?.review).not.toBe(initial.candidates[1]?.review);
  const implementationChanged = storedKeybindings(nodes, {
    ...registrations,
    command: (id) =>
      id === "core.go"
        ? { id, source: { provider: "replacement", implementation: "new-code" } }
        : registrations.command(id),
  });
  expect(implementationChanged.candidates[0]?.review).not.toBe(initial.candidates[0]?.review);
  expect(implementationChanged.candidates[1]?.review).not.toBe(initial.candidates[1]?.review);
  expect(storedKeybindings(nodes.toReversed(), registrations)).toEqual(initial);
});
