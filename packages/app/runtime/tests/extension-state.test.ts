import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  rootExtensionState,
  invalidateRootExtensions,
  resetRootExtensionStates,
} from "../src/extension-state.ts";

test("a root's selection and compiled readings share one lifetime, independently of other roots", () => {
  try {
    const a = rootExtensionState("state-contract-a");
    const b = rootExtensionState("state-contract-b");
    const selected = Effect.succeed({ links: [], installed: [], failures: [] });
    a.selection = selected;
    b.selection = selected;
    a.closures.set("fixture", Effect.succeed({ closures: [], failures: [], rows: [] }));
    expect(rootExtensionState(a.root)).toBe(a);
    invalidateRootExtensions(a.root);
    const replaced = rootExtensionState(a.root);
    expect(replaced).not.toBe(a);
    expect(replaced.selection).toBeUndefined();
    expect(replaced.closures.size).toBe(0);
    expect(rootExtensionState(b.root)).toBe(b);
    expect(b.selection).toBe(selected);
  } finally {
    resetRootExtensionStates();
  }
});
