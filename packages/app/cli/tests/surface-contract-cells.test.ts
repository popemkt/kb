/**
 * The surface contract runs each of its cells (`@kb/test-kit`'s
 * `SURFACE_CONTRACT_CELLS`) from a file of its own,
 * `surface-contract.<cell>.test.ts`, so a run that parallelises files runs
 * them side by side. A cell no file ran would be a promise no test keeps, so
 * the files are held to the cells: one per cell, each running the cell it is
 * named for, and none for a cell the contract does not have.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SURFACE_CONTRACT_CELLS } from "@kb/test-kit";

const CELL_FILE = /^surface-contract\.(.+)\.test\.ts$/;
const byName = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "");

describe("the surface contract's cells", () => {
  const files = readdirSync(import.meta.dir).filter((name) => CELL_FILE.test(name));

  test("each runs from a file of its own, and every such file is a cell's", () => {
    expect(files.map((name) => CELL_FILE.exec(name)?.[1]).toSorted(byName)).toEqual(
      Object.keys(SURFACE_CONTRACT_CELLS).toSorted(byName),
    );
  });

  test("each file runs the cell it is named for", () => {
    for (const name of files) {
      const cell = CELL_FILE.exec(name)?.[1];
      expect(readFileSync(join(import.meta.dir, name), "utf8"), name).toContain(
        `surfaceContract(SURFACES, SURFACE_CONTRACT_CELLS["${cell}"]);`,
      );
    }
  });
});
