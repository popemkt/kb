/**
 * The scripts nodes name (DESIGN.md → Sandbox → Scripts): `ext.code.script.list`
 * tells, for each subject in order, the `#script` nodes it names
 * (`sys.f.scripts`) that kb can run, with what each may ask and whether a
 * person trusts it on this machine — so a view that runs scripts can say
 * which it runs without knowing what a script is (`ext.canvas.describe`).
 */
import { Effect } from "effect";
import type { z } from "zod";
import { ScriptListAction, CodeTrust, KbCtx, type ExtensionAction } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { codeDigest } from "@kb/sandbox";
import { scriptIdsOf, scriptOf } from "./script.ts";

const scriptListEffect = Effect.fn("ext.code.script.list")(function* (
  input: z.infer<typeof ScriptListAction.definition.inputSchema>,
): Effect.fn.Return<
  z.infer<typeof ScriptListAction.definition.outputSchema>,
  DomainError,
  KbCtx | CodeTrust
> {
  const ctx = yield* KbCtx;
  const named = input.subjects.flatMap((subject) =>
    scriptIdsOf(ctx.index.getNode(subject)).flatMap((id) => {
      const script = scriptOf(id, (of) => ctx.index.getNode(of));
      return script === null ? [] : [{ subject, script }];
    }),
  );
  const digests = yield* Effect.forEach(named, ({ script }) =>
    codeDigest(script.code, script.grant),
  );
  const trusted = new Set(yield* (yield* CodeTrust).trusted(digests));
  return {
    scripts: named.map(({ subject, script }, i) => ({
      id: script.id,
      label: script.label,
      subject,
      reads: script.grant.reads,
      actions: [...script.grant.actions],
      trusted: trusted.has(digests[i] ?? ""),
    })),
  };
});

export function scriptListAction(family: string): ExtensionAction {
  return {
    ...ScriptListAction.bind(family),
    title: "List the scripts nodes name",
    description:
      "For each subject node in order, the #script nodes it names (sys.f.scripts) that kb can run: each one's id, name, grant (what it may read and call) and whether a person trusts it on this machine. An untrusted script never runs; trusting one is a person's act.",
    mode: { kind: "read" },
    targets: ["subjects"],
    effect: scriptListEffect,
  };
}
