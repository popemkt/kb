/** `kb field`, `kb tag` and `kb ontology`: the nodes that shape the others. */
import type { Command } from "commander";
import { Effect } from "effect";
import { FIELD_TYPES, SYSTEM_IDS, resolveFieldId, resolveTagId } from "@kb/model";
import { collect, kbAction, runPlanEffect, type IdOpts } from "../command.ts";
import {
  mapFieldDefine,
  mapFieldList,
  mapFieldTarget,
  mapFieldTargetQuery,
  mapFieldType,
  mapOntologyList,
  mapOntologyMembers,
  mapTagDefine,
  mapTagList,
} from "../map.ts";

export function schemaCommands(program: Command): void {
  const field = program.command("field").description("Field operations");
  field
    .command("define")
    .description("Mint a field node")
    .argument("<name>", "field name")
    .option("--id <id>", "explicit id")
    .action(
      kbAction((ctx, globals, [name, opts]: [string, IdOpts]) =>
        runPlanEffect(ctx, mapFieldDefine({ name, id: opts.id }), globals),
      ),
    );
  field
    .command("list")
    .description("List field nodes")
    .action(kbAction((ctx, globals) => runPlanEffect(ctx, mapFieldList(), globals)));
  field
    .command("type")
    .description(`Set sys.f.fieldType on a field (${FIELD_TYPES.join("|")})`)
    .argument("<field>", "field name or id")
    .argument("<type>", "field type")
    .action(
      kbAction((ctx, globals, [fieldName, type]: [string, string]) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const node = ctx.nodes.find((n) => n.id === fieldId);
          // Props are multi-valued and set appends, so the prior value has to
          // be unset explicitly — whichever form it was stored in.
          const previous = node?.props[SYSTEM_IDS.fieldTypeField]?.[0];
          return yield* runPlanEffect(ctx, mapFieldType({ fieldId, type, previous }), globals);
        }),
      ),
    );
  field
    .command("target")
    .description("Add sys.f.targetTag constraint (union) on a ref field")
    .argument("<field>", "field name or id")
    .argument("<tag>", "tag name or id")
    .action(
      kbAction((ctx, globals, [fieldName, tag]: [string, string]) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const tagId = resolveTagId(ctx.nodes, tag);
          return yield* runPlanEffect(ctx, mapFieldTarget({ fieldId, tagId }), globals);
        }),
      ),
    );
  field
    .command("target-query")
    .description("Set sys.f.targetQuery EDN constraint (wins over targetTag)")
    .argument("<field>", "field name or id")
    .argument("<edn>", "datalog EDN returning allowed node ids")
    .action(
      kbAction((ctx, globals, [fieldName, edn]: [string, string]) =>
        Effect.gen(function* () {
          const fieldId = resolveFieldId(ctx.nodes, fieldName);
          const node = ctx.nodes.find((n) => n.id === fieldId);
          const prev = node?.props[SYSTEM_IDS.targetQueryField]?.[0];
          const previous = prev?.t === "str" ? { t: "str" as const, v: prev.v } : undefined;
          return yield* runPlanEffect(
            ctx,
            mapFieldTargetQuery({ fieldId, edn, previous }),
            globals,
          );
        }),
      ),
    );

  const tag = program.command("tag").description("Tag operations");
  tag
    .command("define")
    .description("Mint a tag node")
    .argument("<name>", "tag name")
    .option("--id <id>", "explicit id")
    .option("--field <name>", "templated field (repeatable)", collect, [])
    .option("--extends <tag>", "a tag it extends (repeatable, in order)", collect, [])
    .action(
      kbAction(
        (ctx, globals, [name, opts]: [string, IdOpts & { field: string[]; extends: string[] }]) =>
          runPlanEffect(
            ctx,
            mapTagDefine({ name, id: opts.id, fields: opts.field, extends: opts.extends }),
            globals,
          ),
      ),
    );
  tag
    .command("list")
    .description("List tag nodes")
    .action(kbAction((ctx, globals) => runPlanEffect(ctx, mapTagList(), globals)));

  const ontology = program.command("ontology").description("Ontology operations (#ontology nodes)");
  ontology
    .command("list")
    .description("List #ontology nodes")
    .action(kbAction((ctx, globals) => runPlanEffect(ctx, mapOntologyList(), globals)));
  ontology
    .command("members")
    .description("Resolve an ontology's members (tags + pins + query + extends)")
    .argument("<id>", "ontology node id")
    .option("--reasons", "include per-member provenance")
    .action(
      kbAction((ctx, globals, [id, opts]: [string, { reasons?: boolean }]) =>
        runPlanEffect(ctx, mapOntologyMembers({ id, reasons: opts.reasons === true }), globals),
      ),
    );
}
