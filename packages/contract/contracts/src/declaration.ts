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
import type { DeclaredOptionSet, KbNode, NodeId, SeedRetirement } from "@kb/model";
import type { FieldRefCarrier } from "@kb/query";
import type { ViewKey } from "@kb/views";
import { definePlugin, type Plugin } from "@kb/plugin";
import { ViewKeyPoint, type ViewDef } from "./view-catalog.ts";
import { ContextReferencePoint, type ContextReference } from "./context.ts";

export interface ExtensionDeclaration {
  /** The family's name: the one home of it, which its plugins and its manifest row read. */
  readonly name: string;
  readonly label: string;
  /**
   * The family can be switched, and is `byDefault` in a store where no one
   * has switched it. Whether it is on is the server's decision, never the
   * browser's: a host loads an optional family only while it is on
   * (`familyOn`), and `kb.manifest.extensions` reports it either way. A
   * family without it is required: on wherever it is composed, whatever its
   * switch node says.
   */
  readonly optional?: { readonly byDefault: "on" | "off" };
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
  /**
   * Its own seed nodes it files under core's list nodes, by the list's id
   * (`SeedSource.files`): a pin among the Pinned, a view node among the
   * Views.
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
   * It draws an inline preview of a node its tags open in, under the node's
   * row: its page half offers that view at placement `inline`. The seed
   * derives its preview settings (whether it shows them, whether one starts
   * open, how tall; `previewSettingFields`) as settings of its node.
   */
  readonly inlinePreview?: true;
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
  readonly refCarriers?: readonly FieldRefCarrier[];
}

/** A family's declaration, as written in its shared package. */
export function defineExtension(declaration: ExtensionDeclaration): ExtensionDeclaration {
  return declaration;
}

/**
 * What both hosts load of a declaration: its views, each contributed to
 * {@link ViewKeyPoint} under its view id. A view id already carries its
 * namespace (`<namespace>.<local id>`), so the plugin sits in the root
 * namespace. A host's entry plugin loads it as a child, or loads it as is.
 */
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

export function declarationPlugin(declaration: ExtensionDeclaration): Plugin {
  return definePlugin({
    name: declaration.name,
    tags: familyTags(declaration),
    namespace: "",
    apply: (ctx) =>
      Effect.all(
        [
          Effect.forEach(
            declaration.views ?? [],
            (view) => ctx.contribute(ViewKeyPoint, { id: view.key.id, value: view }),
            { discard: true },
          ),
          Effect.forEach(
            Object.entries(declaration.context ?? {}),
            ([id, value]) => ctx.contribute(ContextReferencePoint, { id, value }),
            { discard: true },
          ),
        ],
        { discard: true },
      ),
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
 * `bundled`, `host` (composed by `kb ui`) or a repository extension's path.
 */
export const ExtensionRowSchema = z.object({
  name: z.string(),
  label: z.string(),
  optional: z.boolean(),
  enabled: z.boolean(),
  source: z.string(),
  /** Where the page imports a repository extension's page half from (`extensionPagePath`). */
  page: z.string().optional(),
  /** The closure digest a person trusted a repository extension at; a bundled one has none. */
  digest: z.string().optional(),
});

export type ExtensionRow = z.infer<typeof ExtensionRowSchema>;

/**
 * A declaration's row, as the host that composes it from `source` reports
 * it, with the path its page half is served at when it has one the page's
 * build does not hold, and the digest it was trusted at when it is a
 * repository extension.
 */
export function extensionRow(
  declaration: ExtensionDeclaration,
  source: string,
  enabled: boolean,
  page?: string,
  digest?: string,
): ExtensionRow {
  return {
    name: declaration.name,
    label: declaration.label,
    optional: declaration.optional !== undefined,
    enabled,
    source,
    ...(page === undefined ? {} : { page }),
    ...(digest === undefined ? {} : { digest }),
  };
}

/** The extensions the host composes, loaded or not: what `kb.manifest` reports. */
export class ExtensionCatalog extends Context.Service<ExtensionCatalog, readonly ExtensionRow[]>()(
  "kb/ExtensionCatalog",
) {}
