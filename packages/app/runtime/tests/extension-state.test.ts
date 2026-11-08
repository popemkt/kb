import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  rootExtensionState,
  invalidateRootExtensions,
  resetRootExtensionStates,
} from "../src/extension-state.ts";

test("a root's selection and compiled readings share one lifetime, independently of other roots", () => {
  try {
    const a = rootExtensionState("state-contract-a", "one");
    const b = rootExtensionState("state-contract-b", "one");
    const selected = Effect.succeed({ links: [], installed: [], failures: [] });
    a.selection = selected;
    b.selection = selected;
    a.closures.set("fixture", Effect.succeed({ closures: [], failures: [], rows: [] }));
    expect(rootExtensionState(a.root, "one")).toBe(a);
    invalidateRootExtensions(a.root);
    const replaced = rootExtensionState(a.root, "one");
    expect(replaced).not.toBe(a);
    expect(replaced.selection).toBeUndefined();
    expect(replaced.closures.size).toBe(0);
    expect(rootExtensionState(b.root, "one")).toBe(b);
    expect(b.selection).toBe(selected);
  } finally {
    resetRootExtensionStates();
  }
});

test("a changed lock fingerprint replaces exactly that root generation", () => {
  try {
    const a = rootExtensionState("changed-a", "one");
    const b = rootExtensionState("changed-b", "one");
    expect(rootExtensionState(a.root, "one")).toBe(a);
    const next = rootExtensionState(a.root, "two");
    expect(next).not.toBe(a);
    expect(next.selection).toBeUndefined();
    expect(next.closures.size).toBe(0);
    expect(rootExtensionState(b.root, "one")).toBe(b);
  } finally {
    resetRootExtensionStates();
  }
});
