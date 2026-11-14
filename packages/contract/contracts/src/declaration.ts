import { ColorTokenPoint } from "./design-tokens.ts";
import {
  SHORTCUT_IDS,
  keyboardNodes,
  shortcutGroupId,
  keyTargetNodeId,
  keyboardIn,
  keyboardShortcutIds,
  keyboardCommandIds,
  type KeyboardDefinition,
} from "@kb/keybindings";
import type { PointDefinition } from "./point-definitions.ts";
import type { ProviderRole } from "./roles.ts";
import {
  ExtensionOriginSchema,
  ExtensionReviewSchema,
  isKbOrigin,
  type ExtensionOrigin,
} from "./extension-review.ts";
import type { ExtensionManifest } from "./extension-manifest.ts";
/**
 * A family declares itself once (DESIGN.md → Extension families): its name,
 * how it is labelled, the system nodes it seeds and the views it provides.
 * The seed fold reads the declarations of the bundled list
 * (`bundledSeed()`), and each host's entry plugin is built from the same
 * declaration ({@link declarationPlugin}), so the seed, the catalog and the
 * name cannot differ between hosts.
 */
import { Context, Effect } from "effect";
import { z } from "zod";
import {
  extensionNodeId,
  type DeclaredOptionSet,
  type KbNode,
  type NodeId,
  type SeedRetirement,
} from "@kb/model";
import type { ValueRefCarrier } from "@kb/query";
import type { ViewKey } from "@kb/views";
import {
  definePlugin,
  kernelHosts,
  type ContributionEntry,
  type KernelHost,
  type KernelSpec,
  type Plugin,
  type PointKey,
} from "@kb/plugin";
import { ViewKeyPoint, type ViewDef } from "./view-catalog.ts";
import { KeyContextPoint, KeybindingPoint, contributeKeyboard } from "./keybindings.ts";
import { ContextReferencePoint, type ContextReference } from "./context.ts";
import {
  MigrationPoint,
  migrationProcedure,
  migrationProcedureId,
  type ExtensionMigration,
} from "./migration.ts";
import { ProcedurePoint } from "./procedure.ts";

export interface ExtensionDeclaration {
  /** Pure fallback values, available even while a family is disabled. */
  readonly colorTokens?: Readonly<Record<`--${string}`, string>>;
  /** The family's name: the one home of it, which its plugins and its manifest row read. */
  readonly name: string;
  readonly label: string;
  /**
   * What the family says about itself (`ExtensionManifest`): its one line,
   * and what it reaches beyond the graph. Only kb's build declares it here;
   * a repository extension keeps it in its manifest file, which kb reads
   * before anyone trusts the code.
   */
  readonly manifest?: ExtensionManifest;
  /**
   * How the family starts in a store where no one has switched it: `on`
   * when it says nothing. Every family can be switched unless it declares
   * {@link required}. Whether it is on is the server's decision, never the
   * browser's: a host loads a family only while it is on (`familyOn`), and
   * `kb.manifest.extensions` reports it either way.
   */
  readonly optional?: { readonly byDefault: "on" | "off" };
  /**
   * Why kb cannot run without the family, in plain words: what Settings
   * shows beside its lock. A family that declares it is on wherever it is
   * composed, whatever its switch node says, and `extension.switch` refuses
   * it. Being required is a claim only kb's own build makes about itself:
   * a repository extension that declares it is refused
   * (`decodeExtensionModule`), so anything installed or linked can be
   * switched off. It never comes with {@link optional}.
   */
  readonly required?: string;
  /**
   * The family's labels (DESIGN.md → Plugin organisation), the one home of
   * them: every plugin of the family carries them (`familyTags`), and the
   * kernel reports them and never reads them. Default: none.
   */
  readonly tags?: readonly string[];
  /**
   * The system nodes the family seeds, under frozen ids. Only a bundled
   * family's declaration is folded into the seed; a host or repository
   * plugin contributes none.
   */
  readonly seed?: (at: string) => readonly KbNode[];
  /** One keyboard definition supplies default graph descriptions and the page contributions. */
  readonly keyboard?: KeyboardDefinition;
  /** Bundled role nodes derived by the same seed fold as views and options. */
  readonly roles?: readonly ProviderRole[];
  /** Bundled point metadata, read before any page implementation loads. */
  readonly points?: readonly PointDefinition[];
  /**
   * Its own seed nodes it files under a list node, by the list's id
   * (`SeedSource.files`): a pin among the Pinned, a view node among the
   * Views, or a node only it reads under its own node.
   */
  readonly files?: Readonly<Record<NodeId, readonly NodeId[]>>;
  /** The views the family provides; the seed derives each one's option node from its key. */
  readonly views?: readonly ViewDef<unknown>[];
  /**
   * The context references the family resolves on a pane, by their full id
   * (`ext.canvas.open`, or core's bare `focused`): what a call made in a tab
   * session may fill a required input from (`ContextReference`). Declared
   * here, so every host that loads the family resolves them alike.
   */
  readonly context?: Readonly<Record<string, ContextReference>>;
  /**
   * The view type a node that names no view opens in, when this family is
   * the one that provides it: one of its own `views`, by its key. The seed
   * writes it as `sys.views`' default (`sys.f.view.default`), and refuses a
   * second provider, so the shell names no view.
   */
  readonly defaultView?: ViewKey<unknown>;
  /**
   * The tags whose nodes open in one of its own `views` before the store's
   * default (DESIGN.md → View nodes): by the tag's id, the view's key. The
   * seed writes each as the tag node's `sys.f.view.default`, which a person
   * may change there, and refuses a tag another declaration claims, so a
   * repository extension that claims one is refused as a unit.
   */
  readonly tagDefaultViews?: Readonly<Record<NodeId, ViewKey<unknown>>>;
  /**
   * The tags whose nodes an outline draws as one of its own `views`, in
   * place of their row's text while no one edits it (DESIGN-UI.md → Row
   * views): by the tag's id, the view's key, which its page half provides
   * at placement `row`. The seed writes each as the tag node's
   * `sys.f.view.row`, which a person may change there, and refuses a tag
   * another declaration claims, as it does `tagDefaultViews`.
   */
  readonly tagRowViews?: Readonly<Record<NodeId, ViewKey<unknown>>>;
  /**
   * The declared options the family contributes (DESIGN.md → Extension
   * families → Declared options), by kind: page-head backdrops
   * (`BACKDROP_OPTIONS`), design systems (`DESIGN_SYSTEM_OPTIONS`), or the
   * kind of a field another family seeds. Each is named by the id its page
   * contribution answers to, and the seed derives its option node under
   * its kind's field, so choosing one is writing that field.
   */
  readonly declaredOptions?: readonly DeclaredOptionSet[];
  /**
   * The seeded ids the family renamed or removed since a store could have
   * been seeded with them, each with its replacement if any: its rows of
   * the seed's retirement table (DESIGN.md → Extension families → the seed
   * retires what it renames), which opening applies before it seeds.
   */
  readonly retires?: readonly SeedRetirement[];
  /**
   * The family's fields whose values carry references beyond `[[id]]`
   * tokens and ref values, each with how to read them: the reference
   * relation reads them as carriers (`:node/mentions`, `derivedWith` in
   * `@kb/query`), so a node's References show what points at it this way.
   */
  readonly refCarriers?: readonly ValueRefCarrier[];
  /**
   * The data migrations the family ships (DESIGN.md → Action registry →
   * Plugin data migrations), each run as the procedure
   * `migration.<family>.<id>` every surface walks.
   */
  readonly migrations?: readonly ExtensionMigration[];
  /**
   * What a running host adds to the family (DESIGN.md → Plugin channels →
   * host entries): each capability only a host can serve, with why and the
   * actions it serves. Its host entry (`hostEntry`) serves exactly these;
   * every other part of the family runs in every process. Only kb's build
   * declares one: a repository extension that does is refused, as no host
   * composes one.
   */
  readonly host?: HostPart;
}

/** One thing only a running host can do for its family, and why. */
interface HostCapability {
  /** Its name, once in its family. */
  readonly name: string;
  /** Why it needs a host, in one line: what a surface says when no host runs. */
  readonly reason: string;
  /** The actions it serves, by local id in the family's namespace (`ext.<name>.<id>`). */
  readonly actions: readonly string[];
}

/** What a running host adds to its family: each capability only a host can serve. */
interface HostPart {
  readonly capabilities: readonly HostCapability[];
}

/** A family's declaration, as written in its shared package. */
export function defineExtension(declaration: ExtensionDeclaration): ExtensionDeclaration {
  const keyboard = declaration.keyboard;
  if (keyboard === undefined) return declaration;
  return {
    ...declaration,
    keyboard: {
      ...keyboard,
      bindings: (keyboard.bindings ?? []).map((entry) => ({
        ...entry,
        value: {
          ...entry.value,
          shortcut: shortcutGroupId(
            declaration.name,
            entry.value.context,
            keyTargetNodeId(declaration.name, entry.value.context, entry.value.run),
          ),
        },
      })),
    },
    seed: (at) => [
      ...(declaration.seed?.(at) ?? []),
      ...keyboardNodes(declaration.name, keyboard, at),
    ],
    files: {
      ...declaration.files,
      [extensionNodeId(declaration.name)]: [
        ...(declaration.files?.[extensionNodeId(declaration.name)] ?? []),
        ...keyboardCommandIds(declaration.name, keyboard),
      ],
      [SHORTCUT_IDS.parent]: [
        ...(declaration.files?.[SHORTCUT_IDS.parent] ?? []),
        ...keyboardShortcutIds(declaration.name, keyboard),
      ],
    },
  };
}

/**
 * The tags a plugin of `declaration`'s family carries: the family's, then
 * any of the plugin's own (`"ui"` on a browser half).
 */
export function familyTags(
  declaration: ExtensionDeclaration,
  ...own: readonly string[]
): readonly string[] {
  return [...(declaration.tags ?? []), ...own];
}

/** Whether a kernel of `host` accepts contributions to every point of `points`, by their own specs. */
function accepts(host: KernelHost, ...points: readonly { readonly spec: KernelSpec }[]): boolean {
  return points.every((point) => kernelHosts(point.spec).includes(host));
}

/**
 * What every host loads of a declaration: its views, each contributed to
 * {@link ViewKeyPoint} under its view id, its context references, and each
 * migration with the procedure that runs it. A view id already carries its
 * namespace (`<namespace>.<local id>`), so the plugin sits in the root
 * namespace. A host's entry plugin loads it as a child, or loads it as is.
 *
 * Each part goes only to a kernel its point accepts, read from the point's
 * own spec (`kernelHosts`): migrations and their procedures are the
 * registry's and the server's, keys the registry's and the page's, so each
 * host loads what its kernel holds of the same declaration (DESIGN.md →
 * Point specifications).
 */
export function declarationPlugin(declaration: ExtensionDeclaration): Plugin {
  return definePlugin({
    name: declaration.name,
    tags: familyTags(declaration),
    namespace: "",
    apply: (ctx) => {
      /** `entries` contributed to `point` where this kernel accepts it, and nowhere else. */
      const contributeEach = <C>(point: PointKey<C>, entries: readonly ContributionEntry<C>[]) =>
        Effect.forEach(
          accepts(ctx.host, point) ? entries : [],
          (entry) => ctx.contribute(point, entry),
          {
            discard: true,
          },
        );
      const migrations = (declaration.migrations ?? []).map((migration) => ({
        id: `${declaration.name}.${migration.id}`,
        migration,
      }));
      return Effect.all(
        [
          accepts(ctx.host, KeybindingPoint, KeyContextPoint)
            ? contributeKeyboard(ctx, keyboardIn(declaration.name, declaration.keyboard ?? {}))
            : Effect.void,
          contributeEach(
            ColorTokenPoint,
            declaration.colorTokens === undefined
              ? []
              : [{ id: declaration.name, value: declaration.colorTokens }],
          ),
          contributeEach(
            ViewKeyPoint,
            (declaration.views ?? []).map((view) => ({ id: view.key.id, value: view })),
          ),
          contributeEach(
            ContextReferencePoint,
            Object.entries(declaration.context ?? {}).map(([id, value]) => ({ id, value })),
          ),
          contributeEach(
            MigrationPoint,
            migrations.map(({ id, migration }) => ({ id, value: migration })),
          ),
          contributeEach(
            ProcedurePoint,
            migrations.map(({ id, migration }) => ({
              id: migrationProcedureId(id),
              value: migrationProcedure(id, migration),
            })),
          ),
        ],
        { discard: true },
      );
    },
  });
}

/**
 * A family as a host composes it: the declaration that names it, and the
 * plugin that host loads for it. The server's bundled families and the
 * `kb ui` host's own extensions (the agent) are both this shape, so both
 * report through {@link extensionRow}.
 */
export interface ExtensionEntry {
  readonly declaration: ExtensionDeclaration;
  readonly entry: Plugin;
}

/**
 * One extension as a host reports it (`kb.manifest.extensions`): what the
 * page follows. `enabled` says the host holds it loaded; `source` is
 * `bundled`, `host` (composed by `kb ui`) or a repository extension's path,
 * and `origin` is how it came to be composed, so no reader infers it from
 * `source`. `required` is its declaration's reason, present only for a
 * family no store can switch off.
 */
export const ExtensionRowSchema = z.object({
  ...ExtensionReviewSchema.shape,
  origin: ExtensionOriginSchema,
  name: z.string(),
  label: z.string(),
  required: z.string().optional(),
  enabled: z.boolean(),
  source: z.string(),
  /** Where the page imports a repository extension's page half from (`extensionPagePath`). */
  page: z.string().optional(),
  /** The closure digest a person trusted a repository extension at; a bundled one has none. */
  digest: z.string().optional(),
});

export type ExtensionRow = z.infer<typeof ExtensionRowSchema>;

/**
 * Where a host composes a family from: kb's build (`bundled`), the `kb ui`
 * host (`host`), or a module path with the origin that selected it.
 */
type ExtensionFrom =
  | "bundled"
  | "host"
  | { readonly source: string; readonly origin: ExtensionOrigin };

/** A family's source and origin, from where a host composes it. */
function extensionFrom(from: ExtensionFrom): {
  readonly source: string;
  readonly origin: ExtensionOrigin;
} {
  return typeof from === "string" ? { source: from, origin: { kind: from } } : from;
}

/** Who ships kb's own families, and under what licence. */
const KB_BUILD: ExtensionManifest = {
  author: "kb",
  repository: "https://github.com/popemkt/kb",
  license: "MIT",
};

/**
 * A declaration's row, as the host that composes it `from` reports it,
 * with the path its page half is served at when it has one the page's
 * build does not hold, and the digest it was trusted at when it is a
 * repository extension.
 */
export function extensionRow(
  declaration: ExtensionDeclaration,
  from: ExtensionFrom,
  enabled: boolean,
  page?: string,
  digest?: string,
): ExtensionRow {
  const { source, origin } = extensionFrom(from);
  // kb's build is the author of what it ships: said once here, under what each family declares.
  const manifest = isKbOrigin(origin)
    ? { ...KB_BUILD, ...declaration.manifest }
    : declaration.manifest;
  return {
    name: declaration.name,
    label: declaration.label,
    ...(manifest === undefined ? {} : { manifest }),
    ...(declaration.required === undefined ? {} : { required: declaration.required }),
    enabled,
    source,
    origin,
    ...(page === undefined ? {} : { page }),
    ...(digest === undefined ? {} : { digest }),
  };
}

/** The extensions the host composes, loaded or not: what `kb.manifest` reports. */
export class ExtensionCatalog extends Context.Service<ExtensionCatalog, readonly ExtensionRow[]>()(
  "kb/ExtensionCatalog",
) {}
