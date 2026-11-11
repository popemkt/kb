/**
 * The one command registry, behind both palettes and the runner.
 *
 * A command is registered beside its implementation: an id, when it applies,
 * what it does, and — for commands the graph has no node for — a label and an
 * icon. The ⌘K palette and the node menu are two *queries* over this list, and
 * running a command is a lookup. Before this, the node menu assembled its set
 * inline while rendering and `runPaletteCommand` branched over every id, so the
 * two re-derived availability separately and neither set was enumerable.
 *
 * Two kinds of command live here and the difference is where they are
 * offered (`menu`), which also decides their shape:
 *
 * - `global` commands are the `sys.command` nodes. The node is the source of
 *   truth for the title and the keys, so those rows carry no `chrome` — the
 *   registry binds an id to a handler and restates nothing.
 * - `node` commands act on the row the menu is anchored to. Nothing in the
 *   graph names them, so they carry their own label and icon, and their
 *   `menu` says where the node menu lists them: a group, then an order in
 *   it. A family's command takes a place among the shell's that way, so the
 *   order of this list means nothing.
 *
 * The state a command needs arrives as {@link CommandContext} from the palette
 * that already holds it: `lib/` is the leaf zone, so it reads no store.
 */
import { ulid } from "ulid";
import {
  ArrowBendUpLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  EyeIcon,
  EyeSlashIcon,
  HashIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  StarIcon,
  TextTIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  extensionNodeId,
  hostViewIds,
  isQueryNode,
  isViewNode,
  present,
  typeRefsOf,
  viewOptionOf,
} from "@kb/model";
import type { WireNode } from "@kb/contracts";
import {
  browserHost,
  type Command,
  type CommandContext,
  CommandPoint,
  chooseDesignSystem,
  currentContributions,
  DesignSystemPoint,
  isContextualRef,
  isPinned,
  isSysPrefixed,
  listOntologyItems,
  navigate,
  nodeAction,
  type NodeCommand,
  type NodeCommandListing,
  nodeMenu,
  NODE_MENU_GROUPS,
  nodePath,
  ontologyPath,
  SETTINGS_PATH,
  type OutlineCommandApi,
  type ProvidedView,
  shownDesignSystem,
  ViewPoint,
  SYSTEM_IDS,
  textOr,
  type ThemePref,
  toast,
  WORKSPACE_ROOT_ID,
} from "@kb/ui-sdk";
import { pageOpeningsOf } from "@/lib/node-openings";
import { DEFAULT_QUERY_EDN } from "@/lib/query-node";
import { pageCatalog } from "@/lib/view-catalog";
import { settingsPath } from "@/lib/settings-parts";
import {
  LayoutView,
  layoutPanes,
  localIdOf,
  paramsFromProps,
  type FrameViewKey,
  type LayoutTree,
  type ViewKey,
} from "@kb/views";
import { Result } from "effect";
import type { Contribution } from "@kb/plugin";

const GLOBAL = { where: "global" } as const;

const THEME_CYCLE: readonly ThemePref[] = ["light", "dark", "system"];

/** The member after `current` in a closed cycle. */
function nextIn<T>(cycle: readonly T[], current: T): T {
  const i = cycle.indexOf(current);
  return present(cycle[(i + 1) % cycle.length], "cycle index is a modulo");
}

/** The selected row, else the zoomed root — "which row is this command about". */
export function commandTargetNodeId(outline: OutlineCommandApi): string | null {
  if (outline.selectedNodeId !== null) return outline.selectedNodeId;
  if (outline.rootNodeId && outline.rootNodeId !== WORKSPACE_ROOT_ID) return outline.rootNodeId;
  return null;
}

/** Zoomed root, else selected non-sys row — "which frame owns the view config". */
export function viewTargetFrameId(outline: OutlineCommandApi): string | null {
  if (outline.rootNodeId && outline.rootNodeId !== WORKSPACE_ROOT_ID) return outline.rootNodeId;
  const selected = outline.selectedNodeId;
  if (selected !== null && !isSysPrefixed(selected)) return selected;
  return null;
}

function targetNode(ctx: CommandContext) {
  const id = ctx.target.nodeId;
  return id === null ? undefined : ctx.outline.nodes.get(id);
}

/** The frame a view command edits, or a toast saying there is none. */
function withFrame(ctx: CommandContext, body: (frameId: string) => void | Promise<void>) {
  const frameId = ctx.target.frameId;
  if (frameId === null) {
    toast("select a frame first");
    return undefined;
  }
  return body(frameId);
}

async function setGlobalFrameView(ctx: CommandContext, view: FrameViewKey): Promise<void> {
  await withFrame(ctx, (frameId) => browserHost().writes.setFrameView(frameId, view));
}

/** The ontology to enter: the selected or zoomed one, else the first. */
function preferredOntologyId(ctx: CommandContext): string | null {
  const candidates = listOntologyItems(ctx.outline.wireNodes);
  if (candidates.length === 0) {
    toast("No ontologies yet — try “New ontology”");
    return null;
  }
  const preferred =
    [ctx.outline.selectedNodeId, ctx.outline.rootNodeId].find((id) =>
      candidates.some((c) => c.id === id),
    ) ?? candidates[0]?.id;
  return preferred ?? null;
}

const GLOBAL_COMMANDS: readonly Command[] = [
  {
    id: SYSTEM_IDS.cmdAddNode,
    menu: GLOBAL,
    run: async (ctx) => {
      const selected = ctx.outline.selectedNodeId;
      if (selected !== null) {
        await browserHost().writes.createNodeAfter(selected);
        return;
      }
      const newId = ulid();
      if (await browserHost().writes.captureNode("", newId)) ctx.outline.jumpToNode(newId);
    },
  },
  {
    id: SYSTEM_IDS.cmdAddTag,
    menu: GLOBAL,
    run: async (ctx) => {
      const id = await browserHost().writes.defineTag("untitled-tag");
      if (id !== null) ctx.outline.zoomTo(id);
    },
  },
  {
    id: SYSTEM_IDS.cmdDefineField,
    menu: GLOBAL,
    run: async (ctx) => {
      const id = await browserHost().writes.defineField("untitled-field");
      if (id !== null) ctx.outline.zoomTo(id);
    },
  },
  {
    // The Query tab is gone (W8a); saved queries live under sys.queries.
    id: SYSTEM_IDS.cmdGoQuery,
    menu: GLOBAL,
    run: (ctx) => ctx.outline.zoomTo(SYSTEM_IDS.queriesRoot),
  },
  {
    // W4: #query tag + sys.f.query starter EDN, zoomed for editing.
    id: SYSTEM_IDS.cmdNewQuery,
    menu: GLOBAL,
    run: async (ctx) => {
      const newId = await browserHost().writes.newQueryNode();
      if (newId !== null) ctx.outline.zoomTo(newId);
    },
  },
  {
    id: SYSTEM_IDS.cmdNewOntology,
    menu: GLOBAL,
    run: async () => {
      const id = await browserHost().writes.defineOntology();
      if (id !== null) navigate(ontologyPath(id));
    },
  },
  {
    id: SYSTEM_IDS.cmdEnterOntology,
    menu: GLOBAL,
    run: (ctx) => {
      const id = preferredOntologyId(ctx);
      if (id !== null) navigate(ontologyPath(id));
    },
  },
  {
    id: SYSTEM_IDS.cmdExitOntology,
    menu: GLOBAL,
    run: (ctx) => {
      if (ctx.outline.ontologyId === null) {
        toast("Not inside an ontology");
        return;
      }
      ctx.outline.leaveScope();
    },
  },
  { id: SYSTEM_IDS.cmdSettings, menu: GLOBAL, run: () => navigate(SETTINGS_PATH) },
  {
    id: SYSTEM_IDS.cmdExtensions,
    menu: GLOBAL,
    run: () => navigate(settingsPath("extensions")),
  },
  {
    id: SYSTEM_IDS.cmdToggleTheme,
    menu: GLOBAL,
    run: (ctx) => ctx.prefs.setTheme(nextIn(THEME_CYCLE, ctx.prefs.theme)),
  },
  {
    id: SYSTEM_IDS.cmdSwitchDesignSystem,
    menu: GLOBAL,
    // Through the contributed systems from the one shown, so a stale choice steps from the default.
    run: async () => {
      const host = browserHost();
      const contributed = currentContributions(DesignSystemPoint);
      const shown = shownDesignSystem(contributed, host.node(extensionNodeId("core"))?.props);
      if (shown === null) return;
      const ids = contributed.map(({ value }) => value.key.id);
      await chooseDesignSystem(host.writes, nextIn(ids, shown.value.key.id));
    },
  },
  {
    id: SYSTEM_IDS.cmdToggleWidth,
    menu: GLOBAL,
    run: (ctx) => ctx.prefs.setWidth(ctx.prefs.width === "centered" ? "full" : "centered"),
  },
  {
    id: SYSTEM_IDS.cmdDebugShowFields,
    menu: GLOBAL,
    run: (ctx) => {
      const nodeId = ctx.target.nodeId;
      if (nodeId === null) {
        toast("select a node first");
        return;
      }
      ctx.debugFields.toggle(nodeId);
    },
  },
  {
    // Portal host (the outline's ViewSettingsPopoverHost overlay) anchors to
    // toolbar/frame row; if no DOM host exists it toasts and clears — never a
    // silent no-op.
    id: SYSTEM_IDS.cmdViewFilter,
    menu: GLOBAL,
    run: (ctx) =>
      withFrame(ctx, (frameId) => {
        ctx.ui.setViewSettingsFrameId(frameId);
      }),
  },
  {
    id: SYSTEM_IDS.cmdSaveWorkspace,
    menu: GLOBAL,
    run: async (ctx) => {
      const count = layoutPanes(ctx.workspace.layout).length;
      await ctx.workspace.save(`Workspace · ${count} ${count === 1 ? "pane" : "panes"}`);
    },
  },
  {
    id: SYSTEM_IDS.cmdClosePane,
    menu: GLOBAL,
    when: (ctx) => layoutPanes(ctx.workspace.layout).length > 1,
    run: (ctx) => ctx.workspace.close(ctx.workspace.focused),
  },
];

/** The arrangement a layout view node holds, when the node is one and holds a legal one. */
function layoutOf(ctx: CommandContext): LayoutTree | null {
  const node = targetNode(ctx);
  if (node === undefined || viewOptionOf(node) !== LayoutView.option) return null;
  const params = paramsFromProps(LayoutView, node.props, null, () => {});
  return Result.isSuccess(params) ? params.success.root : null;
}

/**
 * The shell's own node commands. Each says where the node menu lists it,
 * and a conditional one when it is offered (`when`).
 */
const NODE_COMMANDS: readonly NodeCommand[] = [
  {
    id: "add-tag",
    menu: nodeMenu("make", 10),
    chrome: () => ({ label: "Add tag", icon: <HashIcon size={14} weight="bold" /> }),
    run: (ctx) => ctx.palette.openStep("outline.add-tag"),
  },
  {
    // A tag's own fields, views and place are its owner's; a person makes
    // their own tag that is one of it, and changes that (DESIGN-UI.md → The
    // commit decides what a person may write).
    id: "extend-tag",
    menu: nodeMenu("make", 15),
    chrome: () => ({
      label: "Make your own tag that extends this",
      icon: <HashIcon size={14} weight="regular" />,
    }),
    when: (ctx) => typeRefsOf(targetNode(ctx)).includes(SYSTEM_IDS.tag),
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        const name = textOr(ctx.outline.nodes.get(nodeId)?.text.trim(), nodeId);
        void browserHost()
          .writes.defineTag(`my ${name}`, [nodeId])
          .then((id) => {
            if (id !== null) ctx.outline.zoomTo(id);
          });
      }),
  },
  {
    id: "turn-query",
    menu: nodeMenu("make", 20),
    chrome: () => ({
      label: "Turn into query",
      icon: <MagnifyingGlassIcon size={14} weight="bold" />,
    }),
    when: (ctx) => {
      const node = targetNode(ctx);
      return node !== undefined && !isQueryNode(node);
    },
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        // Setting the field is the whole gesture: the field is the kind, so
        // there is no tag to apply alongside it and nothing to keep in sync.
        void browserHost().writes.updateProp(nodeId, SYSTEM_IDS.queryField, {
          t: "str",
          v: DEFAULT_QUERY_EDN,
        });
      }),
  },
  {
    id: "turn-ref",
    menu: nodeMenu("make", 30),
    chrome: () => ({
      label: "Turn into reference…",
      icon: <LinkSimpleIcon size={14} weight="bold" />,
    }),
    when: (ctx) => {
      const node = targetNode(ctx);
      return node !== undefined && !isContextualRef(node);
    },
    run: (ctx) => ctx.palette.openStep("outline.add-ref"),
  },
  {
    id: "add-field",
    menu: nodeMenu("make", 40),
    chrome: () => ({ label: "Add field", icon: <TextTIcon size={14} weight="bold" /> }),
    run: (ctx) => ctx.palette.openStep("outline.add-field"),
  },
  {
    // Kind slot, not badges: `resolveTags` never emits `sys.tag`, so reading
    // the display list made every node look like a non-tag and the menu
    // offered "Make supertag" on nodes that already were one.
    id: "make-supertag",
    menu: nodeMenu("make", 50),
    chrome: () => ({ label: "Make supertag", icon: <HashIcon size={14} weight="fill" /> }),
    when: (ctx) => {
      const node = targetNode(ctx);
      return node !== undefined && !typeRefsOf(node).includes(SYSTEM_IDS.tag);
    },
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        void (async () => {
          if (!(await browserHost().writes.makeSupertag(nodeId))) return;
          // A supertag is schema, so it leaves the outline forest the moment it
          // becomes one. Zoom to it rather than letting the row vanish — and
          // its field template is the next thing anyone wants anyway.
          ctx.outline.zoomTo(nodeId);
        })();
      }),
  },
  {
    id: "search-all",
    menu: nodeMenu("open", 10),
    chrome: () => ({ label: "Search everything… ⌘S", icon: <MagnifyingGlassIcon size={14} /> }),
    run: (ctx) => {
      ctx.palette.close();
      ctx.ui.setGlobalPaletteOpen(true);
    },
  },
  {
    // Tana's panels: the node in a new pane to the right of the focused one.
    id: "open-beside",
    menu: nodeMenu("open", 20),
    chrome: () => ({ label: "Open in panel", icon: <SidebarSimpleIcon size={14} mirrored /> }),
    run: (ctx) =>
      nodeAction(ctx, (nodeId) => {
        ctx.workspace.openBeside(ctx.workspace.focused, nodePath(nodeId));
      }),
  },
  {
    // A saved layout opened as the whole screen, its panes movable again.
    id: "open-as-workspace",
    menu: nodeMenu("open", 30),
    chrome: () => ({ label: "Open as workspace", icon: <SquaresFourIcon size={14} /> }),
    when: (ctx) => layoutOf(ctx) !== null,
    run: (ctx) => {
      const layout = layoutOf(ctx);
      if (layout !== null) ctx.workspace.replace(layout);
      ctx.palette.close();
    },
  },
  {
    id: "indent",
    menu: nodeMenu("arrange", 10),
    chrome: () => ({ label: "Indent", icon: <ArrowRightIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => void browserHost().writes.indentNode(nodeId)),
  },
  {
    id: "outdent",
    menu: nodeMenu("arrange", 20),
    chrome: () => ({ label: "Outdent", icon: <ArrowBendUpLeftIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => void browserHost().writes.outdentNode(nodeId)),
  },
  {
    // Pinning is listing (lib/pinned); the label is the current state so the
    // row reads as a toggle rather than as a fire-and-hope command.
    id: "toggle-pin",
    menu: nodeMenu("mark", 10),
    chrome: (ctx) => {
      const nodeId = ctx.target.nodeId;
      const pinned = nodeId !== null && isPinned(ctx.outline.nodes, nodeId);
      return {
        label: pinned ? "Unpin" : "Pin",
        icon: pinned ? (
          <PushPinSlashIcon size={14} weight="bold" />
        ) : (
          <PushPinIcon size={14} weight="bold" />
        ),
      };
    },
    run: (ctx) => nodeAction(ctx, (nodeId) => void browserHost().writes.togglePin(nodeId)),
  },
  {
    // Per node: the answer is about the node you are looking at; ⌘K's "Debug:
    // show all fields" is the same act on its target
    // (stores/debug-fields.store).
    id: "toggle-debug-fields",
    menu: nodeMenu("mark", 20),
    faceOf: SYSTEM_IDS.cmdDebugShowFields,
    chrome: (ctx) => {
      const nodeId = ctx.target.nodeId;
      const on = nodeId !== null && ctx.debugFields.ids.has(nodeId);
      return {
        label: on ? "Hide debug fields" : "Show debug fields",
        icon: on ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />,
      };
    },
    run: (ctx) => nodeAction(ctx, (nodeId) => ctx.debugFields.toggle(nodeId)),
  },
  {
    id: "delete",
    menu: nodeMenu("remove", 10),
    chrome: () => ({ label: "Delete node", icon: <TrashIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => void browserHost().writes.deleteNode(nodeId)),
  },
  {
    id: "view-filter",
    menu: nodeMenu("view", 90),
    faceOf: SYSTEM_IDS.cmdViewFilter,
    chrome: () => ({ label: "Filter…", icon: <MagnifyingGlassIcon size={14} /> }),
    run: (ctx) => nodeAction(ctx, (nodeId) => ctx.ui.setViewSettingsFrameId(nodeId)),
  },
];

/**
 * The frame views provided, as commands: each view's `sys.command` node, and a
 * node-menu row named and drawn by its picker, in the pickers' order.
 */
function frameViewCommands(ctx: CommandContext): {
  readonly global: readonly CommandRegistration[];
  readonly node: readonly CommandRegistration[];
} {
  const views = ctx.outline.frameViews();
  return {
    global: views.flatMap(({ key, picker }): CommandRegistration[] =>
      picker.command === undefined
        ? []
        : [
            hostCommand(
              { id: picker.command, menu: GLOBAL, run: (c) => setGlobalFrameView(c, key) },
              { view: key.id },
              [key],
            ),
          ],
    ),
    node: views.map(
      ({ key, picker }): CommandRegistration =>
        hostCommand(
          {
            id: `view-as-${localIdOf(key)}`,
            menu: nodeMenu("view", 10),
            faceOf: picker.command,
            chrome: () => {
              const Icon = picker.icon;
              return {
                label: `View as: ${key.label}`,
                icon: Icon === undefined ? null : <Icon size={14} weight={picker.iconWeight} />,
              };
            },
            run: (c) =>
              nodeAction(c, (nodeId) => void browserHost().writes.setFrameView(nodeId, key)),
          },
          { view: key.id },
          [key],
        ),
    ),
  };
}

/** What a menu calls a view node: its text, else the label of the view it names. */
function viewLabel(byId: ReadonlyMap<string, WireNode>, viewId: string): string {
  const view = byId.get(viewId);
  const text = view?.text.trim() ?? "";
  if (text !== "") return text;
  const option = viewOptionOf(view);
  return (option === null ? undefined : byId.get(option)?.text) ?? viewId;
}

/**
 * "Make default view" for the target (DESIGN.md → View nodes): on a host, a
 * row for each view it names after its default; on a view node, a row for
 * each host that names it after another view. Each moves the view first in
 * that host's `sys.f.views`.
 */
function defaultViewCommands(ctx: CommandContext): readonly CommandRegistration[] {
  const targetId = ctx.target.nodeId;
  if (targetId === null) return [];
  const wires = ctx.outline.wireNodes;
  const byId = new Map(wires.map((n) => [n.id, n]));
  const target = byId.get(targetId);
  const ofHost = hostViewIds(target)
    .slice(1)
    .map((viewId) => ({
      hostId: targetId,
      viewId,
      label: `Make default view: ${viewLabel(byId, viewId)}`,
    }));
  const ofView = isViewNode(target)
    ? wires
        .filter((host) => hostViewIds(host).indexOf(targetId) > 0)
        .map((host) => ({
          hostId: host.id,
          viewId: targetId,
          label: `Make default view of ${host.text.trim() || host.id}`,
        }))
    : [];
  return [...ofHost, ...ofView].map(
    ({ hostId, viewId, label }): CommandRegistration =>
      hostCommand(
        {
          id: `make-default-view:${hostId}:${viewId}`,
          menu: nodeMenu("view", 20),
          chrome: () => ({ label, icon: <StarIcon size={14} /> }),
          run: async (c) => {
            c.palette.close();
            await browserHost().writes.makeDefaultView(hostId, viewId);
          },
        },
        { hostId, viewId },
      ),
  );
}

/**
 * "Open with…" for the target (DESIGN-UI.md → Opening a node): a row for
 * each way this page can open it (`pageOpeningsOf`), the one it opens in by
 * default marked so. A view a tag of it names is its tag opening, "Open in
 * …", and leads the menu. Each moves the focused pane to the node opened
 * that way; nothing is written.
 */
function openWithCommands(ctx: CommandContext): readonly CommandRegistration[] {
  const nodeId = ctx.target.nodeId;
  if (nodeId === null) return [];
  const byId = new Map(ctx.outline.wireNodes.map((n) => [n.id, n]));
  const views = currentContributions(ViewPoint);
  const openings = pageOpeningsOf(nodeId, pageCatalog(), views, (id) => byId.get(id));
  return openings.flatMap(
    ({ view, label, key, tag, default: isDefault }): CommandRegistration[] => {
      if (view === undefined) return [];
      const Icon = views.find(({ value }) => value.key === key)?.value.picker?.icon;
      return [
        hostCommand(
          {
            id: `open-with:${view}`,
            // The view a tag of the node names is how the node itself opens: it leads.
            menu: tag === undefined ? nodeMenu("open", 40) : nodeMenu("lead", 10),
            chrome: () => ({
              label:
                tag === undefined
                  ? `Open with: ${label}${isDefault ? " (default)" : ""}`
                  : `Open in ${label}`,
              icon: Icon === undefined ? <ArrowSquareOutIcon size={14} /> : <Icon size={14} />,
            }),
            run: (c) => {
              c.palette.close();
              browserHost().navigatePane(c.workspace.focused, nodePath(nodeId, view));
            },
          },
          { nodeId, viewId: view },
          key === undefined ? [] : [key],
        ),
      ];
    },
  );
}

/** A view key captured by a host-generated command, with its live page providers. */
interface CommandViewDependency {
  readonly key: ViewKey<unknown>;
  readonly registrations: readonly Contribution<ProvidedView>[];
}

/** The actual runner entry; provenance is a code reference, never an approval grant. */
interface CommandRegistration {
  readonly command: Command;
  readonly source:
    | {
        readonly kind: "host";
        readonly input: Readonly<Record<string, string>>;
        readonly views: readonly CommandViewDependency[];
      }
    | { readonly kind: "contribution"; readonly registration: Contribution<Command> };
}

function hostCommand(
  command: Command,
  input: Readonly<Record<string, string>> = {},
  keys: readonly ViewKey<unknown>[] = [],
): CommandRegistration {
  return {
    command,
    source: {
      kind: "host",
      input,
      views: keys.map((key) => ({
        key,
        registrations: currentContributions(ViewPoint).filter(({ value }) => value.key === key),
      })),
    },
  };
}

/** Every runner entry, in order; graph descriptions never manufacture membership. */
export function commandsFor(ctx: CommandContext): readonly CommandRegistration[] {
  const views = frameViewCommands(ctx);
  return [
    ...GLOBAL_COMMANDS.map((command) => hostCommand(command)),
    ...views.global,
    ...NODE_COMMANDS.map((command) => hostCommand(command)),
    ...openWithCommands(ctx),
    ...views.node,
    ...defaultViewCommands(ctx),
    ...currentContributions(CommandPoint).map((registration) => ({
      command: registration.value,
      source: { kind: "contribution" as const, registration },
    })),
  ];
}

/** Where `menu` lists a command: its group's place, then its order in the group. */
function menuRank(menu: NodeCommand["menu"]): readonly [number, number] {
  return [NODE_MENU_GROUPS.indexOf(menu.group), menu.order];
}

/**
 * The commands this node offers, in the node menu's order: by group, then
 * by order in the group, then in the order they were listed, contributions
 * in the order their plugins loaded. The node menu's query over the registry.
 */
export function listNodeCommands(ctx: CommandContext): NodeCommandListing[] {
  return commandsFor(ctx)
    .map(({ command }) => command)
    .filter(
      (command): command is NodeCommand =>
        command.menu.where === "node" && (command.when?.(ctx) ?? true),
    )
    .toSorted((a, b) => {
      const [groupA, orderA] = menuRank(a.menu);
      const [groupB, orderB] = menuRank(b.menu);
      return groupA - groupB || orderA - orderB;
    })
    .map((command) => {
      const chrome = command.chrome(ctx);
      return {
        id: command.id,
        faceOf: command.faceOf,
        label: chrome.label,
        icon: chrome.icon,
        run: () => void runCommand(command.id, ctx),
      };
    });
}

/** Run a command by id — the runner both palettes share. */
export async function runCommand(commandId: string, ctx: CommandContext): Promise<void> {
  const command = commandsFor(ctx).find((entry) => entry.command.id === commandId)?.command;
  if (command === undefined) {
    toast(`Unknown command: ${commandId}`);
    return;
  }
  await command.run(ctx);
}
