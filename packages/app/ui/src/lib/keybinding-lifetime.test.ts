/** Replacement admission stays fail-closed while the page host is being withdrawn. */
import { afterEach, expect, it } from "vitest";
import { Effect } from "effect";
import { KeybindingPoint, KeyContextPoint } from "@kb/contracts";
import { definePlugin } from "@kb/plugin";
import { currentKeymap, syncUiPlugins } from "@kb/ui-sdk";
import { browserHostUiPlugin } from "@/browser-host";
import { coreUiPlugin } from "@/core-plugin";

const owner = definePlugin({
  name: "lifetime",
  apply: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.contribute(KeyContextPoint, {
        id: "editing",
        value: { reach: "surface", intents: ["original", "replacement"], reserved: [] },
      });
      yield* ctx.contribute(KeybindingPoint, {
        id: "enter",
        value: {
          context: "lifetime.editing",
          chord: { key: "Enter", mod: false },
          run: { intent: "original" },
        },
      });
    }),
});
const foreign = definePlugin({
  name: "foreign",
  apply: (ctx) =>
    ctx
      .contribute(KeybindingPoint, {
        id: "enter",
        value: {
          context: "lifetime.editing",
          chord: { key: "Enter", mod: false },
          replaces: "lifetime.enter",
          run: { intent: "replacement" },
        },
      })
      .pipe(Effect.asVoid),
});
const press = () => currentKeymap("lifetime.editing").resolve({ key: "Enter" })?.value.run;
afterEach(() => syncUiPlugins([]));
it("withdraws approval with its host and can reload it without stranding plugin scopes", () => {
  syncUiPlugins([browserHostUiPlugin, coreUiPlugin, owner, foreign]);
  expect(press()).toEqual({ intent: "replacement" });
  expect(() => syncUiPlugins([coreUiPlugin, owner, foreign])).not.toThrow();
  expect(press()).toEqual({ intent: "original" });
  syncUiPlugins([browserHostUiPlugin, coreUiPlugin, owner, foreign]);
  expect(press()).toEqual({ intent: "replacement" });
  expect(() => syncUiPlugins([])).not.toThrow();
});
