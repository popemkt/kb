import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { z } from "zod";
import { makeKernel, type PluginError } from "@kb/plugin";
import { ChannelPoint, type Channel } from "../src/channel.ts";
import type { ExtensionDeclaration } from "../src/declaration.ts";
import { ActionPoint, type ExtensionAction } from "../src/extension.ts";
import { hostEntry, type HostEntryContext } from "../src/host-entry.ts";

const declaration: ExtensionDeclaration = {
  name: "live",
  label: "Live",
  host: { capabilities: [{ name: "engine", reason: "it runs in the host", actions: ["go"] }] },
};
const action = (id: string): ExtensionAction => ({
  id,
  title: id,
  description: id,
  mode: { kind: "read" },
  inputSchema: z.object({}),
  outputSchema: z.unknown(),
  effect: () => Effect.succeed(id),
});
const channel: Channel = { receive: () => Effect.void, drop: () => Effect.void };

/** What loading `apply` as `declaration`'s host entry leaves: the exit, actions and channels. */
const loaded = (apply: (host: HostEntryContext) => Effect.Effect<void, PluginError>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kernel = makeKernel({ host: "server" });
      const exit = yield* Effect.exit(kernel.load(hostEntry(declaration, { apply })));
      const actions = kernel.contributions(ActionPoint).map(({ id }) => id);
      const channels = kernel.contributions(ChannelPoint).map(({ id }) => id);
      yield* kernel.shutdown;
      return { exit, actions, channels };
    }),
  );

test("a host entry serves its declared capability in its namespace, and owns channels", async () => {
  const { exit, actions, channels } = await loaded((host) =>
    Effect.asVoid(
      Effect.all([host.serve("engine", [action("go")]), host.channel("status", channel)]),
    ),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(actions).toEqual(["ext.live.go"]);
  expect(channels).toEqual(["live.status"]);
});

test("a capability the declaration does not name, or other actions than it lists, fail the load", async () => {
  for (const apply of [
    (host: HostEntryContext) => host.serve("other", [action("go")]),
    (host: HostEntryContext) => host.serve("engine", [action("go"), action("more")]),
    (host: HostEntryContext) => host.serve("engine", []),
  ]) {
    const { exit, actions } = await loaded(apply);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(actions).toEqual([]);
  }
});

test("a host entry's handle has no member that contributes, provides or loads", () => {
  const members: readonly (keyof HostEntryContext)[] = ["get", "channel", "serve"];
  // @ts-expect-error -- a host entry cannot contribute an ordinary action
  const contribute: keyof HostEntryContext = "contribute";
  // @ts-expect-error -- nor load a plugin that would
  const plugin: keyof HostEntryContext = "plugin";
  expect(members).not.toContain(contribute);
  expect(members).not.toContain(plugin);
});
