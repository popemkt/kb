/**
 * The interception points' matching cost (`bun run bench`): many listeners,
 * many actions, and what finding a call's listeners costs once the index
 * has seen the action, beside scanning every listener per call, as a host
 * without the index would. Like the store benchmark, it prints a table and
 * asserts nothing; it runs only when named.
 */
import { describe, test } from "bun:test";
import { Effect } from "effect";
import type { ActionGuard, ApprovalCall, Listener } from "@kb/contracts";
import { matchSpecificity } from "@kb/model";
import { interceptionOf } from "@kb/operations";
import { writeOut } from "../src/output.ts";

const enabled = Bun.argv.some((arg) => arg.endsWith("benchmark.test.ts"));
const LISTENERS = 2000;
const ACTIONS = 400;
const CALLS = 200_000;

function listeners(): Listener<ActionGuard>[] {
  const matches = (i: number): string => {
    if (i % 4 === 0) return `ext.f${i % 50}.a${i % ACTIONS}`;
    if (i % 4 === 1) return `ext.f${i % 50}.*`;
    if (i % 4 === 2) return i % 8 === 2 ? "every write" : "every read";
    return `ext.f${i % 50}.a${i % 10}*`;
  };
  return Array.from({ length: LISTENERS }, (_, i) => ({
    owner: `p${i}`,
    id: `g${i}`,
    value: { match: matches(i), before: () => Effect.succeed({ decision: "allow" as const }) },
  }));
}

function actions(): ApprovalCall["action"][] {
  return Array.from({ length: ACTIONS }, (_, i) => ({
    id: `ext.f${i % 50}.a${i}`,
    mode: { kind: i % 3 === 0 ? "write" : "read" },
  }));
}

function timed(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

if (enabled) {
  describe(`benchmark interception — ${LISTENERS} listeners, ${ACTIONS} actions`, () => {
    test("prints the matching table", () => {
      const all = listeners();
      const called = actions();
      const interception = interceptionOf({ guards: all });
      const first = timed(() => {
        for (const action of called) interception.guards(action);
      });
      const sequence = Array.from({ length: CALLS }, (_, i) => called[i % ACTIONS] ?? called[0]);
      let found = 0;
      const indexed = timed(() => {
        for (const action of sequence) if (action) found += interception.guards(action).length;
      });
      const scanned = timed(() => {
        for (const action of sequence) {
          if (!action) continue;
          found -= all.filter(({ value }) => matchSpecificity(value.match, action) !== null).length;
        }
      });
      writeOut(`| interception phase (${CALLS} calls) | ms |`);
      writeOut("|---|---:|");
      writeOut(`| index every action once | ${first.toFixed(1)} |`);
      writeOut(`| indexed lookup | ${indexed.toFixed(1)} |`);
      writeOut(`| scan every listener | ${scanned.toFixed(1)} |`);
      writeOut(`| (checksum, 0 when both agree) | ${found} |`);
    }, 120_000);
  });
}
