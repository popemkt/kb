/**
 * The family's ids name the family its declaration names: `defineExtension`
 * takes a literal name (the harness reads it), and `DAYS_FAMILY` is the same
 * name for the ids the seed needs before the declaration exists.
 */
import { describe, expect, test } from "bun:test";
import { extensionNodeId } from "@kb/model";
import { DAYS_FAMILY, DAYS_IDS, daysExtension } from "../src/index.ts";

describe("days declaration", () => {
  test("ids and declaration name one family", () => {
    expect(daysExtension.name).toBe(DAYS_FAMILY);
    expect(DAYS_IDS.family).toBe(extensionNodeId(daysExtension.name));
  });
});
