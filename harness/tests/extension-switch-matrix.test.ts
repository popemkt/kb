import { describe, expect, test } from "bun:test";
import { COMPOSITIONS, switchMatrix } from "../src/compositions.ts";

const familyOf = (plugin: string) => plugin.split("/")[0];

describe.each([...COMPOSITIONS])("the %s family switches", (host) => {
  test("each optional family can leave while the other plugins and registry reads still work", () => {
    const { baseline, cases } = switchMatrix(host);
    expect(cases.length).toBeGreaterThan(0);
    for (const { family, composition, predicted, internalReads } of cases) {
      expect(internalReads).toEqual([]);
      expect(composition.plugins.filter(({ name }) => familyOf(name) === family)).toEqual([]);
      const active = new Set(
        composition.plugins.filter(({ status }) => status === "active").map(({ name }) => name),
      );
      const pending = composition.plugins.filter(({ status }) => status === "pending");
      const failed = composition.plugins.filter(({ status }) => status === "failed");
      expect(failed.map(({ name, error }) => ({ family, name, error }))).toEqual([]);
      for (const { name, missing } of pending) {
        const affected = baseline.dependencies
          .filter(({ from, to }) => from === name && !active.has(to))
          .map(({ name: key }) => key);
        const prior = baseline.plugins.find((plugin) => plugin.name === name)?.missing ?? [];
        const expected = new Set([...affected, ...prior]);
        expect({
          family,
          name,
          unexpected: missing.filter((key) => !expected.has(key)),
        }).toEqual({ family, name, unexpected: [] });
      }
      const present = new Set(composition.plugins.map(({ name }) => name));
      const vanished = baseline.plugins.filter(
        ({ name, parent }) =>
          familyOf(name) !== family &&
          !present.has(name) &&
          (parent === null || active.has(parent)),
      );
      expect(vanished.map(({ name }) => ({ family, name }))).toEqual([]);
      if (predicted !== null) {
        const newlyPending = pending
          .filter(({ name }) =>
            baseline.plugins.some((plugin) => plugin.name === name && plugin.status === "active"),
          )
          .map(({ name }) => name);
        expect({ family, plugins: newlyPending.toSorted() }).toEqual({
          family,
          plugins: predicted.toSorted(),
        });
      }
    }
  }, 120_000);
});
