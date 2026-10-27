/**
 * `kb ext`: the extensions this root composes. `list` prints
 * `extension.list`'s report (each one on or off with its tags, what it
 * injects from whom and provides, the ordered points' listeners and the
 * modules refused) with the actions each registered and how much it
 * contributes, `footprint` prints what one adds (`extension.footprint`), and `sdk`
 * prints or writes the ambient types a repository extension compiles
 * against. `validate` is admission (`admitExtensions`): it fails while any
 * of the root's extensions would be skipped, so a gate can refuse one.
 */
import type { Command } from "commander";
import { Effect } from "effect";
import { z } from "zod";
import {
  type ActionReceipt,
  ExtensionReportSchema,
  FootprintRowSchema,
  onWire,
  type ExtensionReport,
  type ExtensionReportRow,
  type FootprintRow,
  type KbContext,
} from "@kb/contracts";
import { ensureDomainError } from "@kb/model";
import type { RegisteredAction } from "@kb/operations";
import { KB_SDK_VERSION, readEmbeddedSdkDts, writeSdkDts } from "@kb/ext-sdk";
import { canonicalRoot } from "@kb/workspace-fs";
import {
  admitExtensions,
  invokeReceiptEffect,
  resolveRootEffect,
  sessionRegistry,
  writeOut,
} from "@kb/runtime";
import {
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
  invokeReceiptEffect(
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

export function extensionCommands(program: Command): void {
  const ext = program.command("ext").description("Extension operations");
  ext
    .command("list")
    .description(
      "List the extensions (bundled + .kb/extensions), each on or off, and the actions of those loaded",
    )
    .action(
      kbAction((ctx, globals) =>
        Effect.gen(function* () {
          const registry = yield* sessionRegistry(ctx);
          const receipt = yield* footprint(ctx);
          const rows = footprintRows(receipt.status === "succeeded" ? receipt.output : null);
          const listing = yield* invokeReceiptEffect(
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
  ext
    .command("validate")
    .description(
      "Admit every extension as a gate: load each .kb/extensions module as if trusted, every family on, and fail on any that would be skipped. It runs the extension code of the root it is run inside (never one --root names elsewhere), so run it where you would run the checkout's tests; it trusts nothing on this machine",
    )
    .action(cliAction(validate));
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
