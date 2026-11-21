/** `kb add`, `set`, `unset`, `get`, `export`, `rm` and `mv`: one node, or a subtree, at a time. */
import type { Command } from "commander";
import { Effect } from "effect";
import type { KbContext } from "@kb/contracts";
import type { ActionHandlerEnv } from "@kb/runtime";
import { toInt } from "../arguments.ts";
import {
  collect,
  kbAction,
  runPlanEffect,
  type ForceOpts,
  type GlobalOpts,
  type IdOpts,
} from "../command.ts";
import {
  declaredTypes,
  mapAdd,
  mapAddTree,
  mapExport,
  mapGet,
  mapMv,
  mapRm,
  mapSet,
  mapUnset,
  parseFieldValue,
  parsePropArg,
  UsageError,
} from "../map.ts";
import { readTextArgEffect } from "../input.ts";

interface AddOpts extends IdOpts, ForceOpts {
  parent?: string;
  top?: boolean;
  position?: number;
  tag: string[];
  prop: string[];
  matching?: string;
  create?: boolean;
  outline?: string;
  format?: string;
}

/**
 * `kb add`: one node from argv (`node.add`), or a whole outline from a file or
 * stdin (`node.addTree`), placed by the same `--parent` / `--top` /
 * `--position`. Without `--parent` or `--top` it lands where captures go,
 * the capture target (DESIGN.md → Provider roles). An outline carries its
 * own text, tags, fields and ids, so the flags that would say them again are
 * refused rather than merged.
 */
function addEffect(
  ctx: KbContext,
  globals: GlobalOpts,
  text: string | undefined,
  opts: AddOpts,
): Effect.Effect<number, Error, ActionHandlerEnv> {
  return Effect.gen(function* () {
    const create = { create: opts.create === true };
    if (opts.top === true && opts.parent !== undefined) {
      return yield* new UsageError({ message: "kb add: --parent and --top name two places" });
    }
    const parent = opts.top === true ? null : opts.parent;
    if (opts.outline === undefined) {
      if (text === undefined) {
        return yield* new UsageError({ message: "kb add: missing <text> (or --outline <file>)" });
      }
      const plan = mapAdd({
        text,
        parent,
        position: opts.position,
        tags: opts.tag,
        props: opts.prop.map((arg) => parsePropArg(arg, declaredTypes(ctx.nodes))),
        matching: opts.matching,
        id: opts.id,
        force: opts.force === true,
      });
      return yield* runPlanEffect(ctx, plan, globals, create);
    }
    if (
      text !== undefined ||
      opts.tag.length > 0 ||
      opts.prop.length > 0 ||
      opts.matching !== undefined ||
      opts.id !== undefined
    ) {
      return yield* new UsageError({
        message:
          "kb add --outline takes text, tags, fields and ids from the outline itself, and matches no query",
      });
    }
    const outline = yield* readTextArgEffect("--outline", opts.outline);
    const plan = mapAddTree({
      outline,
      format: opts.format,
      parent,
      position: opts.position,
      force: opts.force === true,
    });
    return yield* runPlanEffect(ctx, plan, globals, create);
  });
}
interface SetOpts extends ForceOpts {
  create?: boolean;
}
interface MvOpts extends ForceOpts {
  position?: number;
  rootParent?: boolean;
}

export function nodeCommands(program: Command): void {
  program
    .command("add")
    .description("Create a node, or a whole outline in one transaction (--outline)")
    .argument("[text]", "node text")
    .option("--outline <file>", "add an outline from a file, or - for stdin")
    .option("--format <id>", "the outline's format: tana (default), md, logseq, plain or json")
    .option("--parent <id>", "parent node id (default: the capture target, today's node with days)")
    .option("--top", "add at the top level, not the capture target", false)
    .option("--position <n>", "child index", toInt)
    .option("--tag <name>", "tag name (repeatable)", collect, [])
    .option("--prop <field=value>", "prop (repeatable)", collect, [])
    .option(
      "--matching <query-id>",
      "give it what the query's conditions require (tags, values, a child-of's parent)",
    )
    .option("--id <id>", "explicit node id")
    .option("--create", "mint missing fields", false)
    .option("--force", "allow minting or parenting under sys.* nodes", false)
    .action(
      kbAction((ctx, globals, [text, opts]: [string | undefined, AddOpts]) =>
        addEffect(ctx, globals, text, opts),
      ),
    );

  program
    .command("set")
    .description("Set a property on a node")
    .argument("<id>", "node id")
    .argument("<field>", "field name or id")
    .argument("<value>", "value, parsed as the field's declared type")
    .option("--create", "mint missing field", false)
    .option("--force", "allow edits on sys.* nodes", false)
    .action(
      kbAction((ctx, globals, [id, field, value, opts]: [string, string, string, SetOpts]) =>
        runPlanEffect(
          ctx,
          mapSet({
            id,
            field,
            value: parseFieldValue(value, declaredTypes(ctx.nodes)(field), field),
            force: opts.force === true,
          }),
          globals,
          { create: opts.create === true },
        ),
      ),
    );

  program
    .command("unset")
    .description("Unset a property on a node")
    .argument("<id>", "node id")
    .argument("<field>", "field name or id")
    .argument("[value]", "specific value to remove, parsed as the field's declared type")
    .option("--force", "allow edits on sys.* nodes", false)
    .action(
      kbAction(
        (ctx, globals, [id, field, value, opts]: [string, string, string | undefined, ForceOpts]) =>
          runPlanEffect(
            ctx,
            mapUnset({
              id,
              field,
              value:
                value === undefined
                  ? undefined
                  : parseFieldValue(value, declaredTypes(ctx.nodes)(field), field),
              force: opts.force === true,
            }),
            globals,
          ),
      ),
    );

  program
    .command("get")
    .description("Pull a node subtree")
    .argument("<id>", "node id")
    .option("--depth <n>", "pull depth", toInt, 1)
    .action(
      kbAction((ctx, globals, [id, opts]: [string, { depth: number }]) =>
        runPlanEffect(ctx, mapGet({ id, depth: opts.depth }), globals),
      ),
    );

  program
    .command("export")
    .description("Write nodes, and what is under them, as text in an outline format")
    .argument("<ids...>", "node ids")
    .option("--format <id>", "md (default), plain, html, tana, logseq or json")
    .option("--refs <form>", "how a reference is written: label (default), link or id")
    .option("--indent <unit>", "spaces (default) or tabs")
    .option("--no-children", "each node alone, without what is under it")
    .option("--no-fields", "without tags and fields")
    .action(
      kbAction(
        (
          ctx,
          globals,
          [ids, opts]: [
            string[],
            { format?: string; refs?: string; indent?: string; children: boolean; fields: boolean },
          ],
        ) => runPlanEffect(ctx, mapExport({ ids, ...opts }), globals),
      ),
    );

  program
    .command("rm")
    .description("Delete a node")
    .argument("<id>", "node id")
    .option("--force", "allow deleting sys.* nodes", false)
    .action(
      kbAction((ctx, globals, [id, opts]: [string, ForceOpts]) =>
        runPlanEffect(ctx, mapRm({ id, force: opts.force === true }), globals),
      ),
    );

  program
    .command("mv")
    .description("Move a node under a new parent (use --root-parent to detach)")
    .argument("<id>", "node id")
    .argument("[parent]", "new parent id")
    .option("--position <n>", "child index", toInt)
    .option("--root-parent", "detach from parent", false)
    .option("--force", "allow moving under sys.* parents", false)
    .action(
      kbAction((ctx, globals, [id, parent, opts]: [string, string | undefined, MvOpts]) =>
        Effect.gen(function* () {
          const parentArg = opts.rootParent === true ? null : parent;
          if (parentArg === undefined) {
            return yield* new UsageError({ message: "mv requires <parent> or --root-parent" });
          }
          return yield* runPlanEffect(
            ctx,
            mapMv({
              id,
              parent: parentArg,
              position: opts.position,
              force: opts.force === true,
            }),
            globals,
          );
        }),
      ),
    );
}
