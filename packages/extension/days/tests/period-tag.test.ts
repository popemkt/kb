import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode, type NodeWrite } from "@kb/model";
import { DAYS_IDS } from "../src/ids";
import { periodTagOf, periodTagRefusal } from "../src/period-tag";
import { planDay } from "../src/plan";

const ref = (v: string) => [{ t: "ref" as const, v }];

const AT = "2026-11-11T00:00:00.000Z";

function node(id: string, props: KbNode["props"] = {}, text = id): KbNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

/** A tag of the person's, extending `bases`. */
const tag = (id: string, ...bases: string[]) =>
  node(
    id,
    bases.length === 0
      ? {}
      : { [SYSTEM_IDS.extendsField]: bases.map((v) => ({ t: "ref" as const, v })) },
  );

const family = (props: KbNode["props"]) => node(DAYS_IDS.family, props);

function graph(...nodes: KbNode[]): Map<string, KbNode> {
  return new Map([node(DAYS_IDS.dayTag), node(DAYS_IDS.weekTag), ...nodes].map((n) => [n.id, n]));
}

function read(g: Map<string, KbNode>): string {
  return periodTagOf(g.get(DAYS_IDS.family), DAYS_IDS.dayTagField, DAYS_IDS.dayTag, (id) =>
    g.get(id),
  );
}

function write(before: KbNode | undefined, after: KbNode | undefined): NodeWrite {
  return { before, after };
}

describe("periodTagOf", () => {
  test("no setting is the base", () => {
    expect(read(graph(family({})))).toBe(DAYS_IDS.dayTag);
  });

  test("a tag that extends the base, directly or through another, is chosen", () => {
    expect(
      read(
        graph(tag("my-day", DAYS_IDS.dayTag), family({ [DAYS_IDS.dayTagField]: ref("my-day") })),
      ),
    ).toBe("my-day");
    expect(
      read(
        graph(
          tag("journal-day", DAYS_IDS.dayTag),
          tag("my-day", "journal-day"),
          family({ [DAYS_IDS.dayTagField]: ref("my-day") }),
        ),
      ),
    ).toBe("my-day");
  });

  test("a tag that does not extend the base, or is gone, reads as the base", () => {
    expect(read(graph(tag("other"), family({ [DAYS_IDS.dayTagField]: ref("other") })))).toBe(
      DAYS_IDS.dayTag,
    );
    expect(read(graph(family({ [DAYS_IDS.dayTagField]: ref("gone") })))).toBe(DAYS_IDS.dayTag);
  });
});

describe("planDay with period tag settings", () => {
  test("a new day and week carry the chosen tags; the year stays #year", () => {
    const g = graph(
      tag("my-day", DAYS_IDS.dayTag),
      tag("my-week", DAYS_IDS.weekTag),
      family({ [DAYS_IDS.dayTagField]: ref("my-day"), [DAYS_IDS.weekTagField]: ref("my-week") }),
    );
    const plan = planDay(g, "2026-11-10", () => "fresh");
    expect(plan.make.map((m) => [m.key, m.tag])).toEqual([
      [null, null],
      ["2026", DAYS_IDS.yearTag],
      ["2026-W46", "my-week"],
      ["2026-11-10", "my-day"],
    ]);
  });
});

describe("periodTagRefusal", () => {
  test("pointing day tag at a tag that extends #day lands", () => {
    const g = graph(tag("my-day", DAYS_IDS.dayTag));
    const after = family({ [DAYS_IDS.dayTagField]: ref("my-day") });
    expect(periodTagRefusal([write(family({}), after)], (id) => g.get(id))).toBeNull();
  });

  test("pointing day tag at a tag that does not extend #day is refused with why", () => {
    const g = graph(tag("other", DAYS_IDS.weekTag));
    const after = family({ [DAYS_IDS.dayTagField]: ref("other") });
    expect(periodTagRefusal([write(family({}), after)], (id) => g.get(id))).toContain(
      "does not extend #day",
    );
  });

  test("a write that leaves the setting as it was is not looked at", () => {
    const g = graph(tag("other"));
    const held = family({ [DAYS_IDS.dayTagField]: ref("other") });
    const renamed = { ...held, text: "Days" };
    expect(periodTagRefusal([write(held, renamed)], (id) => g.get(id))).toBeNull();
  });
});
