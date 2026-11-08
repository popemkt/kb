import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { CodeTrust, ExtensionReportSchema } from "@kb/contracts";
import { SourceReader } from "@kb/extension-source";
import { memorySourceReader } from "@kb/source-git";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKb } from "../src/session.ts";
import { invokeReceiptEffect, resetRegistryCache } from "../src/registry.ts";
import { invoke } from "../src/invoke.ts";

const ownerSource = `
import { ActionPoint, Effect, Schema, defineExtension, definePlugin, extensionNamespace, provideAction } from "kb-ext-sdk";
export const declaration = defineExtension({name:"point-owner",label:"Point owner"});
export default definePlugin({name:declaration.name,namespace:extensionNamespace(declaration.name),apply:ctx=>Effect.gen(function*(){
  const point=yield* ctx.declare("values",{cardinality:"list",combine:"all",kernel:"registry",tier:"T0",contract:Schema.toStandardSchemaV1(Schema.String)});
  yield* ctx.contribute(ActionPoint,provideAction({id:"read",title:"Read",description:"Read foreign contributions",mode:{kind:"read"},inputSchema:Schema.toStandardSchemaV1(Schema.Struct({})),outputSchema:Schema.toStandardSchemaV1(Schema.Array(Schema.String)),effect:()=>Effect.succeed(ctx.contributions(point).map(item=>item.value))}));
})});`;
const contributorSource = `
import { Effect, defineExtension, definePlugin, extensionNamespace } from "kb-ext-sdk";
export const declaration=defineExtension({name:"point-user",label:"Point user"});
export default definePlugin({name:declaration.name,namespace:extensionNamespace(declaration.name),uses:["ext.point-owner.values"],apply:ctx=>Effect.gen(function*(){
  const point=yield* ctx.point("ext.point-owner.values");
  yield* ctx.contribute(point,{id:"foreign",value:"arrived across the installed boundary"});
})});`;
const squatterSource = `
import { Effect, defineExtension, definePlugin } from "kb-ext-sdk";
export const declaration=defineExtension({name:"squatter",label:"Squatter"});
export default definePlugin({name:declaration.name,namespace:"graph",apply:ctx=>ctx.declare("themes",{cardinality:"list",combine:"all",kernel:"registry",tier:"T0"}).pipe(Effect.asVoid)});`;
const revision = "a".repeat(40);
const reader = memorySourceReader(
  new Map(
    (
      [
        ["owner", ownerSource],
        ["user", contributorSource],
        ["squatter", squatterSource],
      ] as const
    ).map(([name, source]) => [
      `sample/${name}`,
      {
        revisions: new Map([
          [
            revision,
            [
              {
                path: `${name === "owner" ? "point-owner" : name === "user" ? "point-user" : "squatter"}.ts`,
                mode: "100644" as const,
                bytes: new TextEncoder().encode(source),
              },
            ],
          ],
        ]),
        parents: new Map(),
        refs: new Map([["refs/heads/main", revision]]),
      },
    ]),
  ),
);
const roots: string[] = [];
afterEach(async () => {
  resetRegistryCache();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "kb-declared-installs-"));
  roots.push(root);
  return openKb(root);
}
async function install(ctx: Awaited<ReturnType<typeof openKb>>, name: string) {
  const receipt = await Effect.runPromise(
    invokeReceiptEffect(ctx, {
      id: "extension.install",
      input: { source: `github:sample/${name}@main` },
      actor: "agent",
    }).pipe(Effect.provide(Layer.merge(kbRuntimeLayer(ctx), Layer.succeed(SourceReader, reader)))),
  );
  expect(receipt.status).toBe("succeeded");
}
async function report(ctx: Awaited<ReturnType<typeof openKb>>) {
  const receipt = await invoke(ctx, { id: "extension.list", input: {} });
  expect(receipt.status).toBe("succeeded");
  return ExtensionReportSchema.parse(receipt.status === "succeeded" ? receipt.output : null);
}
/** The fixture supplies the person's trust, in the runner's scratch KB_HOME. */
async function trust(ctx: Awaited<ReturnType<typeof openKb>>, name: string) {
  const row = (await report(ctx)).extensions.find((candidate) => candidate.name === name);
  if (row?.digest === undefined || row.files === undefined)
    throw new Error(`no reviewed tree for ${name}`);
  const { digest, files } = row;
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* (yield* CodeTrust).trust(digest, { name, files });
    }).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
  resetRegistryCache();
}

test("installed modules connect by name across contained trees", async () => {
  const ctx = await setup();
  await install(ctx, "user");
  await install(ctx, "owner");
  await trust(ctx, "point-user");
  await trust(ctx, "point-owner");
  const receipt = await invoke(ctx, { id: "ext.point-owner.read", input: {} });
  expect(receipt).toMatchObject({
    status: "succeeded",
    output: ["arrived across the installed boundary"],
  });
  const tree = await report(ctx);
  expect(tree.failures).toEqual([]);
  expect(tree.points.find(({ point }) => point === "ext.point-owner.values")).toMatchObject({
    owner: "point-owner",
    listeners: [{ owner: "point-user", id: "ext.point-user.foreign" }],
  });
});

test("an installed contributor alone waits with a named requirement and no error", async () => {
  const ctx = await setup();
  await install(ctx, "user");
  await trust(ctx, "point-user");
  const tree = await report(ctx);
  expect(tree.failures).toEqual([]);
  expect(tree.extensions.find(({ name }) => name === "point-user")).toMatchObject({
    failures: [],
    uses: [{ point: "ext.point-owner.values", from: null }],
  });
});

test("a stranger installed first cannot declare in a bundled family's namespace", async () => {
  const ctx = await setup();
  await install(ctx, "squatter");
  await trust(ctx, "squatter");
  const tree = await report(ctx);
  expect(tree.failures.some(({ error }) => error.includes("namespace must be ext.squatter"))).toBe(
    true,
  );
  expect(tree.points.some(({ point }) => point === "graph.themes")).toBe(false);
});
