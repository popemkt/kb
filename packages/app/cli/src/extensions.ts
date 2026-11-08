/**
 * `kb ext`: the extensions this root composes. `list` prints
 * `extension.list`'s report (each one on or off with its tags, what it
 * injects from whom and provides, the ordered points' listeners and the
 * modules refused) with the actions each registered and how much it
 * contributes, `footprint` prints what one adds (`extension.footprint`),
 * `settings` prints what each one's node can be set to (`extension.settings`), and `sdk`
 * prints or writes the ambient types a repository extension compiles
 * against. `validate` is admission (`admitExtensions`): it fails while any
 * of the root's extensions would be skipped, so a gate can refuse one.
 */
import type { Command } from "commander";
import { Effect } from "effect";
import { z } from "zod";
import {
  DEFAULT_EXTENSION_SCOPE,
  EXTENSION_SCOPES,
  type ActionReceipt,
  type ActionDefinition,
  ExtensionReportSchema,
  ExtensionSettingsSchema,
  FootprintRowSchema,
  onWire,
  type ExtensionReport,
  type ExtensionReportRow,
  type ExtensionSettings,
  type FootprintRow,
  type KbContext,
} from "@kb/contracts";
import { ensureDomainError, schemaToJsonSchema } from "@kb/model";
import {
  extensionUpdateDef,
  extensionOutdatedDef,
  extensionRemoveDef,
  extensionLinkDef,
  extensionUnlinkDef,
  extensionGcDef,
  marketplaceAddDef,
  marketplaceRemoveDef,
  marketplaceUpdateDef,
  marketplaceListDef,
  type RegisteredAction,
} from "@kb/operations";
import { KB_SDK_VERSION, readEmbeddedSdkDts, writeSdkDts } from "@kb/ext-sdk";
import { canonicalRoot } from "@kb/workspace-fs";
import {
  admitExtensions,
  resolveRootEffect,
  sessionRegistry,
  writeErr,
  writeOut,
} from "@kb/runtime";
import {
  invokeCliEffect,
  ACTION_INVOKE_WIRE,
  EXIT_OK,
  cliAction,
  kbAction,
  report,
  type GlobalOpts,
} from "./command.ts";
import { formatMode } from "./format.ts";

const FootprintOutput = z.object({ rows: z.array(FootprintRowSchema) });

/** `extension.footprint`'s rows, as the action answers them; none when it answers otherwise. */
function footprintRows(output: unknown): readonly FootprintRow[] {
  const parsed = FootprintOutput.safeParse(output);
  return parsed.success ? parsed.data.rows : [];
}

/** Every extension's footprint, by the CLI's wire. */
const footprint = (ctx: KbContext, name?: string) =>
  invokeCliEffect(
    ctx,
    onWire(ACTION_INVOKE_WIRE, {
      id: "extension.footprint",
      input: name === undefined ? {} : { name },
    }),
  );

/** A footprint as lines: one per row, its source, kind and id. */
function footprintLines(output: unknown): readonly string[] {
  const rows = footprintRows(output);
  const [first] = rows;
  if (first === undefined) return ["contributes nothing"];
  return [
    `${first.family}${first.enabled ? "" : " (off)"}: ${rows.length} contributed`,
    ...rows.map((row) => `  ${row.source.padEnd(8)} ${row.kind.padEnd(14)} ${row.id}`),
  ];
}

/** A value as `kb set` takes it back: a ref by its id, anything else as itself. */
function valueText(
  value: ExtensionSettings["extensions"][number]["settings"][number]["values"][number],
): string {
  return String(value.v);
}

/**
 * `extension.settings`' answer as lines: each extension's node, then each
 * setting with its field id (what `kb set` writes), its type and how many
 * values it takes, what it holds now, and its options where it has them.
 */
function settingsLines(output: unknown): readonly string[] {
  const parsed = ExtensionSettingsSchema.safeParse(output);
  if (!parsed.success)
    return [`extension.settings answered in another shape: ${parsed.error.message}`];
  const { extensions } = parsed.data;
  if (extensions.length === 0) return ["no settings"];
  return extensions.flatMap(({ name, node, settings }) => [
    `${name} (${node})${settings.length === 0 ? ": no settings" : ""}`,
    ...settings.flatMap(({ field, label, type, cardinality, values, options }) => [
      `  ${label}  ${field}  ${type}${cardinality === "one" ? "" : ", many"}  = ${
        values.length === 0 ? "(unset)" : values.map(valueText).join(", ")
      }`,
      ...(options.length === 0
        ? []
        : [`    options: ${options.map(({ id, label: text }) => `${text} (${id})`).join(", ")}`]),
    ]),
  ]);
}

/** `extension.list`'s report, as the action answers it; empty when it answers otherwise. */
function reportOf(output: unknown): ExtensionReport {
  const parsed = ExtensionReportSchema.safeParse(output);
  return parsed.success ? parsed.data : { extensions: [], points: [], failures: [] };
}

/** Each ordered point's listeners, in the order a host asks them. */
function pointLines(points: ExtensionReport["points"]): string[] {
  return points.flatMap(({ point, source, listeners }) => [
    `${point} (${source}): in order`,
    ...listeners.map(
      ({ owner, id, match }, at) =>
        `  ${at + 1}. ${id} (${owner})${match === undefined ? "" : ` on ${match}`}`,
    ),
  ]);
}

/**
 * How a family's plugins sit among the others (DESIGN.md → Plugin
 * organisation): their tags, each service they inject and who provides it
 * (nobody yet, while nobody does), what they provide, and why any failed.
 */
function organisationLines(row: ExtensionReportRow): string[] {
  const { tags, injects, provides, failures } = row;
  return [
    ...(tags.length === 0 ? [] : [`  tags: ${tags.join(", ")}`]),
    ...injects.map(({ service, from }) => `  injects ${service} from ${from ?? "nobody yet"}`),
    ...provides.map((service) => `  provides ${service}`),
    ...failures.map((failure) => `  ! ${failure}`),
  ];
}

/** The report as `kb ext list` prints it: each extension with its organisation and actions, then the points and refusals. */
function listLines(
  listed: readonly (ExtensionReportRow & {
    readonly contributes: number;
    readonly actions: readonly RegisteredAction[];
  })[],
  { points, failures }: ExtensionReport,
): string[] {
  const lines: string[] = [];
  for (const e of listed) {
    lines.push(`${e.name} (${e.source}${e.enabled ? "" : ", off"}) — contributes ${e.contributes}`);
    if (e.origin !== undefined) lines.push(`  source: ${JSON.stringify(e.origin)}`);
    if (e.shadowed !== undefined) lines.push(`  hidden: shadowed by ${e.shadowed}`);
    if (e.digest !== undefined)
      lines.push(`  ${e.trusted === true ? "trusted" : "untrusted"}: ${e.digest}`);
    if (e.reach !== undefined) lines.push(`  reach: ${JSON.stringify(e.reach)}`);
    lines.push(...organisationLines(e));
    for (const a of e.actions) {
      const alias = a.aliases.length > 0 ? ` (alias: ${a.aliases.join(", ")})` : "";
      lines.push(`  ${a.def.id}${alias} — ${a.def.title} [${formatMode(a.def.mode)}]`);
    }
  }
  lines.push(...pointLines(points));
  for (const f of failures) lines.push(`! ${f.file}: ${f.error} (skipped)`);
  return lines;
}

/** `kb ext settings [name]`: `extension.settings`' answer, printed. */
function settingsCommand(ext: Command): void {
  ext
    .command("settings")
    .description(
      "What each extension's node can be set to: its settings (the fields that configure it), their values and options; write one with `kb set sys.extension.<name> <field> <value>`",
    )
    .argument("[name]", "extension name, as `kb ext list` prints it, or core")
    .action(
      kbAction((ctx, globals, [name]: [string | undefined]) =>
        invokeCliEffect(
          ctx,
          onWire(ACTION_INVOKE_WIRE, {
            id: "extension.settings",
            input: name === undefined ? {} : { name },
          }),
        ).pipe(Effect.map((receipt) => report(receipt, globals, settingsLines))),
      ),
    );
}

/** The id `kb ext validate`'s receipts carry. */
const VALIDATE = "ext.validate";

/**
 * Whether `root` is the root the command runs inside (the one `kb` finds
 * from the working directory): admission runs a root's extensions without
 * trust, so it admits only the checkout it is run from, never one `--root`
 * names elsewhere.
 */
const isWorkingRoot = Effect.fn("kb.ext.isWorkingRoot")(function* (root: string) {
  const here = yield* resolveRootEffect({}).pipe(Effect.orElseSucceed(() => null));
  if (here === null) return false;
  return (yield* canonicalRoot(here)) === (yield* canonicalRoot(root));
});

/** `kb ext validate`: admission (`admitExtensions`) as a receipt, failed while any extension would be skipped. */
const validate = (globals: GlobalOpts) =>
  Effect.gen(function* () {
    const root = yield* resolveRootEffect({ root: globals.root });
    if (!(yield* isWorkingRoot(root))) {
      const refused: ActionReceipt = {
        status: "failed",
        id: VALIDATE,
        code: "forbidden",
        message: `kb ext validate runs ${root}'s extensions without trust, so it admits only the root it is run from: run it inside that checkout`,
      };
      return report(refused, globals, () => []);
    }
    const failures = yield* admitExtensions(root);
    const receipt: ActionReceipt =
      failures.length === 0
        ? { status: "succeeded", id: VALIDATE, output: { failures } }
        : {
            status: "failed",
            id: VALIDATE,
            code: "invalid_input",
            message: `${failures.length} repository extension failure(s); each would be skipped: ${failures.map(({ file }) => file).join(", ")}`,
            details: { failures },
          };
    return report(receipt, globals, () => ["kb extensions: all admitted"]);
  });

function installCommand(ext: Command): void {
  ext
    .command("install")
    .description(
      "Install a GitHub source, or restore trees from this kb's locks; never trusts code",
    )
    .argument("[source]", "github:owner/repo[/path][@ref]")
    .option(
      "--scope <scope>",
      `${EXTENSION_SCOPES.join(", ")} (default: ${DEFAULT_EXTENSION_SCOPE})`,
    )
    .action(
      kbAction((ctx, globals, [source, opts]: [string | undefined, { scope?: string }]) =>
        invokeCliEffect(
          ctx,
          onWire(ACTION_INVOKE_WIRE, {
            id: "extension.install",
            input: {
              ...(source === undefined ? {} : { source }),
              ...(opts.scope === undefined ? {} : { scope: opts.scope }),
            },
          }),
        ).pipe(
          Effect.map((receipt) => report(receipt, globals, (output) => [JSON.stringify(output)])),
        ),
      ),
    );
}

function reviewCommands(ext: Command): void {
  ext
    .command("diff")
    .description("Offline diff against this machine's last trusted tree")
    .argument("<name>")
    .action(
      kbAction((ctx, globals, [name]: [string]) =>
        invokeCliEffect(
          ctx,
          onWire(ACTION_INVOKE_WIRE, { id: "extension.diff", input: { name } }),
        ).pipe(
          Effect.map((receipt) => report(receipt, globals, (output) => [JSON.stringify(output)])),
        ),
      ),
    );
  ext
    .command("trust")
    .description("Review an extension, then ask the person to trust its digest")
    .argument("<name>")
    .action(
      kbAction((ctx, globals, [name]: [string]) =>
        Effect.gen(function* () {
          const listed = yield* invokeCliEffect(
            ctx,
            onWire(ACTION_INVOKE_WIRE, { id: "extension.list", input: {} }),
          );
          if (listed.status !== "succeeded") return report(listed, globals, () => []);
          const row = reportOf(listed.output).extensions.find(
            (candidate) => candidate.name === name && candidate.shadowed === undefined,
          );
          if (row?.digest === undefined)
            return report(
              {
                status: "failed",
                id: "sandbox.trust",
                code: "not_found",
                message: `no compiled extension named ${name}`,
              },
              globals,
              () => [],
            );
          writeErr(
            JSON.stringify(
              {
                name: row.name,
                digest: row.digest,
                origin: row.origin,
                files: row.files,
                reach: row.reach,
              },
              null,
              2,
            ),
          );
          if (row.origin?.kind === "install") {
            const diff = yield* invokeCliEffect(
              ctx,
              onWire(ACTION_INVOKE_WIRE, { id: "extension.diff", input: { name } }),
            );
            if (diff.status !== "succeeded") return report(diff, globals, () => []);
            writeErr(JSON.stringify(diff.output, null, 2));
          }
          const receipt = yield* invokeCliEffect(
            ctx,
            onWire(ACTION_INVOKE_WIRE, {
              id: "sandbox.trust",
              input: {
                digest: row.digest,
                ...(row.origin?.kind === "install" && row.files !== undefined
                  ? { extension: { name, files: row.files } }
                  : {}),
              },
            }),
          );
          return report(receipt, globals, (output) => [JSON.stringify(output)]);
        }),
      ),
    );
}

/** These action adapters derive argument presence and scope support from their registry schemas. */
function extensionVerb(
  parent: Command,
  verb: string,
  definition: Pick<ActionDefinition, "id" | "description" | "inputSchema">,
): void {
  const schema = z
    .object({
      properties: z.record(z.string(), z.unknown()).optional(),
      required: z.array(z.string()).optional(),
    })
    .parse(schemaToJsonSchema(definition.inputSchema, "input"));
  const properties = schema.properties ?? {};
  const flags = Object.entries(properties)
    .filter(([, value]) => z.object({ type: z.literal("boolean") }).safeParse(value).success)
    .map(([key]) => key);
  const field = Object.keys(properties).find((key) => key !== "scope" && !flags.includes(key));
  const command = parent.command(verb).description(definition.description);
  if (field !== undefined)
    command.argument(schema.required?.includes(field) === true ? `<${field}>` : `[${field}]`);
  if ("scope" in properties) command.option("--scope <scope>", EXTENSION_SCOPES.join(", "));
  for (const flag of flags)
    command.option(
      `--${flag}`,
      z.object({ description: z.string().optional() }).parse(properties[flag]).description ?? flag,
    );
  command.action(
    kbAction((ctx, globals, args: unknown[]) => {
      const options = z.record(z.string(), z.unknown()).parse(args[field === undefined ? 0 : 1]);
      const named = Object.fromEntries(
        Object.entries(options).filter(
          ([key, value]) => key in properties && key !== field && value !== undefined,
        ),
      );
      return invokeCliEffect(
        ctx,
        onWire(ACTION_INVOKE_WIRE, {
          id: definition.id,
          input: {
            ...(field === undefined || args[0] === undefined ? {} : { [field]: args[0] }),
            ...named,
          },
        }),
      ).pipe(
        Effect.map((receipt) => report(receipt, globals, (output) => [JSON.stringify(output)])),
      );
    }),
  );
}
function lifecycleCommands(ext: Command): void {
  for (const [verb, definition] of [
    ["update", extensionUpdateDef],
    ["outdated", extensionOutdatedDef],
    ["remove", extensionRemoveDef],
    ["link", extensionLinkDef],
    ["unlink", extensionUnlinkDef],
    ["gc", extensionGcDef],
  ] as const)
    extensionVerb(ext, verb, definition);
  const marketplace = ext.command("marketplace").description("Manage pinned extension indexes");
  for (const [verb, definition] of [
    ["add", marketplaceAddDef],
    ["remove", marketplaceRemoveDef],
    ["update", marketplaceUpdateDef],
    ["list", marketplaceListDef],
  ] as const)
    extensionVerb(marketplace, verb, definition);
}

export function extensionCommands(program: Command): void {
  const ext = program.command("ext").description("Extension operations");
  ext
    .command("list")
    .description(
      "List bundled, owned and selected extensions, each on or off, and the actions of those loaded",
    )
    .action(
      kbAction((ctx, globals) =>
        Effect.gen(function* () {
          const registry = yield* sessionRegistry(ctx);
          const receipt = yield* footprint(ctx);
          const rows = footprintRows(receipt.status === "succeeded" ? receipt.output : null);
          const listing = yield* invokeCliEffect(
            ctx,
            onWire(ACTION_INVOKE_WIRE, { id: "extension.list", input: {} }),
          );
          const extensionReport = reportOf(listing.status === "succeeded" ? listing.output : null);
          // The report's rows, each with the actions it registered when loaded
          // and how many footprint rows it has.
          const { points, failures } = extensionReport;
          const listed = extensionReport.extensions.map((family) => ({
            ...family,
            actions: registry.extensions.find(({ name }) => name === family.name)?.actions ?? [],
            contributes: rows.filter((row) => row.family === family.name).length,
          }));
          if (globals.json === true) {
            writeOut(
              JSON.stringify({
                status: "succeeded",
                id: "ext.list",
                output: {
                  extensions: listed.map((e) => ({
                    ...e,
                    name: e.name,
                    source: e.source,
                    optional: e.optional,
                    enabled: e.enabled,
                    contributes: e.contributes,
                    ...(e.digest === undefined ? {} : { digest: e.digest }),
                    tags: e.tags,
                    injects: e.injects,
                    provides: e.provides,
                    failures: e.failures,
                    actions: e.actions.map((a) => ({
                      id: a.def.id,
                      title: a.def.title,
                      mode: a.def.mode,
                      aliases: a.aliases,
                    })),
                  })),
                  failures,
                  points,
                },
              }),
            );
            return EXIT_OK;
          }
          const lines = listLines(listed, extensionReport);
          writeOut(lines.length > 0 ? lines.join("\n") : "no extensions loaded");
          return EXIT_OK;
        }),
      ),
    );
  ext
    .command("footprint")
    .description(
      "What an extension adds: the nodes it seeds and what it contributes to the hosts running now",
    )
    .argument("<name>", "extension name, as `kb ext list` prints it")
    .action(
      kbAction((ctx, globals, [name]: [string]) =>
        footprint(ctx, name).pipe(
          Effect.map((receipt) => report(receipt, globals, footprintLines)),
        ),
      ),
    );
  installCommand(ext);
  reviewCommands(ext);
  lifecycleCommands(ext);
  settingsCommand(ext);
  ext
    .command("validate")
    .description(
      "Admit every extension as a gate: load each .kb/extensions module as if trusted, every family on, and fail on any that would be skipped. It runs the extension code of the root it is run inside (never one --root names elsewhere), so run it where you would run the checkout's tests; it trusts nothing on this machine",
    )
    .action(cliAction(validate));
  sdkCommand(ext);
}

function sdkCommand(ext: Command): void {
  ext
    .command("sdk")
    .description(
      "Print or write the ambient extension SDK types (kb-ext-sdk, and kb-ext-sdk/page) for this binary",
    )
    .option("--write", "write .kb/sdk.d.ts and .kb/sdk-page.d.ts under the resolved root", false)
    .action(
      cliAction((globals, [opts]: [{ write?: boolean }]) =>
        Effect.gen(function* () {
          if (opts.write !== true) {
            writeOut(readEmbeddedSdkDts());
            return EXIT_OK;
          }
          const root = yield* resolveRootEffect({
            root: globals.root,
            allowCreate: true,
          });
          const result = yield* writeSdkDts(root).pipe(Effect.mapError(ensureDomainError));
          writeOut(
            globals.json === true
              ? JSON.stringify({
                  status: "succeeded",
                  id: "ext.sdk",
                  output: {
                    path: result.path,
                    bytes: result.bytes,
                    version: result.version,
                  },
                })
              : `wrote .kb/sdk.d.ts and .kb/sdk-page.d.ts (kb ${KB_SDK_VERSION})`,
          );
          return EXIT_OK;
        }),
      ),
    );
}
