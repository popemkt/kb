import { Effect, Schema } from "effect";
import { NoParams, viewKey } from "@kb/views";
import { Point, Service, definePlugin, type ContributionEntry } from "@kb/plugin";
import type { KbContext } from "./session.ts";
import type { ActionDefinition, ActionEffectHandler } from "./actions.ts";
import { declarationPlugin, defineExtension, type ExtensionEntry } from "./declaration.ts";
import type { ExtensionTemplate, TemplateFn } from "./template.ts";
import { ViewKeyPoint, viewDef } from "./view-catalog.ts";

/**
 * Extension contract: what a family contributes to the points every host
 * reads. An action is an `ActionDefinition` plus an Effect `effect` handler,
 * preferred, or a legacy Promise `handler`; a render template is an
 * {@link ExtensionTemplate}. A family's plugin contributes each under its
 * local id ({@link provideAction}, {@link provideTemplate}), and its
 * namespace, `ext.<name>`, makes the id `ext.<name>.<id>`, with optional
 * bare-id aliases.
 *
 * A bundled family and a repository extension (`.kb/extensions/<name>.ts`)
 * are the same thing from two sources: a declaration and the plugin each
 * host loads for it (DESIGN.md → Core boundary & extensions). A repository
 * module exports its `declaration` and default-exports its server entry,
 * built with the host module {@link EXTENSION_SDK}; the loader that
 * discovers and imports the modules lives with the runtime.
 */
export type ExtensionPromiseHandler = (ctx: KbContext, input: never) => Promise<unknown>;

export type ExtensionAction = ActionDefinition & {
  /** Extra top-level ids this action also answers to (compat shims). */
  aliases?: readonly string[];
} & (
    | {
        effect: ActionEffectHandler;
        handler?: ExtensionPromiseHandler;
      }
    | {
        handler: ExtensionPromiseHandler;
        effect?: ActionEffectHandler;
      }
  );

/** A family as a root composes it: its declaration, its entry, and `bundled` or its module's path. */
export interface LoadedExtension extends ExtensionEntry {
  readonly source: string;
  /** A repository extension's closure digest: what a person trusted, and what addresses its page half. */
  readonly digest?: string;
  /** A repository extension's page half, the bundled module; a bundled family's is in the page's own build. */
  readonly page?: string;
}

/** Where the `kb ui` server serves the page half of the closure `digest` (`sha256:<hex>`) names. */
export function extensionPagePath(digest: string): string {
  return `/api/extensions/${digest.slice(digest.indexOf(":") + 1)}.js`;
}

/**
 * What each half of a repository extension imports from its host rather
 * than carries, by specifier: kb's own modules, whose keys the kernel
 * compares by identity, and the libraries whose one copy the host holds
 * (zod, by either name, which compiles its parsers at run time; React, whose hooks need the
 * page's one copy). Every other import is bundled into the closure.
 */
export const HOST_MODULES = {
  server: ["kb-ext-sdk", "zod", "zod/v4"],
  page: ["kb-ext-sdk", "kb-ext-sdk/page", "zod", "zod/v4", "react", "react/jsx-runtime"],
} as const;

export type ExtensionHalf = keyof typeof HOST_MODULES;

/** The global symbol's key a bundle reads its host modules through. */
export const HOST_MODULES_KEY = "kb.ext.host";

/**
 * Serve `modules` as this host's, for `half`: every module the half's
 * bundle reads from its host, so a host that leaves one out does not
 * compile. Each host (the server process, the page) installs its own once,
 * before it runs a bundle.
 */
export function installHostModules<H extends ExtensionHalf>(
  half: H,
  modules: Readonly<Record<(typeof HOST_MODULES)[H][number], unknown>>,
): void {
  const served = new Map<string, unknown>(Object.entries(modules));
  Reflect.set(globalThis, Symbol.for(HOST_MODULES_KEY), (id: string) => {
    if (!served.has(id)) throw new Error(`the ${half} serves no host module ${id}`);
    return served.get(id);
  });
}

export interface ExtensionFailure {
  file: string;
  error: string;
}

/**
 * An action as a plugin contributes it to {@link ActionPoint}. The id is the
 * contribution's (namespaced by the plugin), not a field of the value.
 */
export interface ActionContribution extends Omit<ActionDefinition, "id" | "effect"> {
  readonly effect?: ActionEffectHandler;
  readonly handler?: ExtensionPromiseHandler;
}

/** Every action any loaded plugin offers: core's, bundled extensions', the repo's. */
export const ActionPoint = Point<ActionContribution>()("kb.actions");

/** Every render template, by the id a view spec names it with. */
export const TemplatePoint = Point<TemplateFn>()("kb.templates");

/** The namespace a family's plugin contributes in, so its ids read `ext.<name>.<id>`. */
export function extensionNamespace(name: string): string {
  return `ext.${name}`;
}

/** The {@link ActionPoint} contribution for `action`, under its local id. */
export function provideAction(action: ExtensionAction): ContributionEntry<ActionContribution> {
  return { id: action.id, aliases: action.aliases, value: action };
}

/** The {@link TemplatePoint} contribution for `template`, under its local id. */
export function provideTemplate(template: ExtensionTemplate): ContributionEntry<TemplateFn> {
  return { id: template.id, aliases: template.aliases, value: template.template };
}

/**
 * What a repository extension imports as `kb-ext-sdk`: the plugin model and
 * the points and keys a bundled family builds with, as the host's own
 * objects, since the kernel compares keys by identity, and the Effect and
 * Schema its plugins and view keys are written in. The host serves it; an
 * extension never carries a copy. Its types are `@kb/ext-sdk`'s surface.
 */
export const EXTENSION_SDK = {
  Effect,
  Schema,
  definePlugin,
  defineExtension,
  declarationPlugin,
  extensionNamespace,
  Point,
  Service,
  ActionPoint,
  TemplatePoint,
  ViewKeyPoint,
  provideAction,
  provideTemplate,
  viewKey,
  viewDef,
  NoParams,
} as const;
