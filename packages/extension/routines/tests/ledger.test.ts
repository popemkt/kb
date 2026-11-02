import { expect, test } from "bun:test";
import { Effect } from "effect";
import { ledgerContract, makeMemoryLedger } from "../src/index.ts";

const fixture = Effect.gen(function* () {
  const ledger = yield* makeMemoryLedger();
  return { ledger, reopen: Effect.succeed(ledger) };
});
ledgerContract(
  (name, effect) => test("memory ledger: " + name, () => Effect.runPromise(Effect.scoped(effect))),
  fixture,
  { equal: (a, b) => expect(a).toEqual(b), different: (a, b) => expect(a).not.toEqual(b) },
);
