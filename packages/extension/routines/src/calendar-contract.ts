import { Effect, type Scope } from "effect";
import type { CalendarPort, MutationOutcome } from "./ports.ts";
import { SyncError, type EventFields } from "./model.ts";
import type { ContractAssertions, ContractTest } from "./ledger-contract.ts";

export function contractEvent(): EventFields {
  return {
    title: "Morning",
    start: { day: "2026-11-02", at: "07:30", zone: "Asia/Ho_Chi_Minh" },
    end: { day: "2026-11-02", at: "08:00", zone: "Asia/Ho_Chi_Minh" },
    recurrence: ["RRULE:FREQ=DAILY"],
    status: "confirmed",
    nodeId: "routine",
    unit: "series",
    generation: 0,
    backlink: "https://kb.test/node/routine",
    done: false,
  };
}
export function outcomeEvent(outcomes: readonly MutationOutcome[]) {
  const first = outcomes[0];
  if (first?.ok !== true || first.event === null)
    throw new SyncError({ status: 500, code: "contract_failed" });
  return first.event;
}

/** Every CalendarPort adapter runs this suite, including HTTP against a fake server. */
export function calendarContract(
  test: ContractTest,
  client: Effect.Effect<CalendarPort, SyncError, Scope.Scope>,
  assert: ContractAssertions,
): void {
  test(
    "deterministic inserts refuse duplicates",
    Effect.gen(function* () {
      const port = yield* client;
      const calendar = yield* port.create("kb routines", "Asia/Ho_Chi_Minh");
      const fields = contractEvent();
      const inserted = outcomeEvent(
        yield* port.write(calendar, [{ kind: "insert", id: "kb00001", fields }]),
      );
      assert.equal(inserted.id, "kb00001");
      assert.equal((yield* port.get(calendar, inserted.id)).fields, fields);
      const duplicate = (yield* port.write(calendar, [
        { kind: "insert", id: inserted.id, fields },
      ]))[0];
      assert.equal(duplicate?.ok, false);
      assert.equal(duplicate?.ok === false ? duplicate.error.status : 0, 409);
    }),
  );
  test(
    "If-Match preserves concurrent edits on updates and removals",
    Effect.gen(function* () {
      const port = yield* client;
      const calendar = yield* port.create("kb routines", "Asia/Ho_Chi_Minh");
      const first = outcomeEvent(
        yield* port.write(calendar, [{ kind: "insert", id: "kb00001", fields: contractEvent() }]),
      );
      const second = outcomeEvent(
        yield* port.write(calendar, [
          {
            kind: "update",
            id: first.id,
            etag: first.etag,
            fields: { ...contractEvent(), title: "Edited" },
          },
        ]),
      );
      assert.different(first.etag, second.etag);
      for (const change of [
        { kind: "update" as const, id: first.id, etag: first.etag, fields: contractEvent() },
        { kind: "remove" as const, id: first.id, etag: first.etag },
      ]) {
        const answer = (yield* port.write(calendar, [change]))[0];
        assert.equal(answer?.ok === false ? answer.error.status : 0, 412);
      }
      assert.equal((yield* port.get(calendar, first.id)).fields?.title, "Edited");
    }),
  );
  instanceContract(test, client, assert);
  test(
    "pagination supplies a token only after all pages, then incremental changes",
    Effect.gen(function* () {
      const port = yield* client;
      const calendar = yield* port.create("kb routines", "Asia/Ho_Chi_Minh");
      yield* port.write(
        calendar,
        Array.from({ length: 4 }, (_, index) => ({
          kind: "insert" as const,
          id: "kb0000" + index,
          fields: contractEvent(),
        })),
      );
      let page: string | null = null;
      let token: string | null = null;
      let count = 0;
      do {
        const result: Effect.Success<ReturnType<CalendarPort["list"]>> = yield* port.list(
          calendar,
          null,
          page,
        );
        count += result.events.length;
        page = result.nextPage;
        if (page !== null) assert.equal(result.nextToken, null);
        token = result.nextToken;
      } while (page !== null);
      assert.equal(count, 4);
      assert.different(token, null);
      yield* port.write(calendar, [{ kind: "insert", id: "kb00009", fields: contractEvent() }]);
      const incremental = yield* port.list(calendar, token, null);
      assert.equal(
        incremental.events.map((event) => event.id),
        ["kb00009"],
      );
      const invalid = yield* Effect.result(port.list(calendar, "invalid-token", null));
      assert.equal(invalid._tag, "Failure");
    }),
  );
}

function instanceContract(
  test: ContractTest,
  client: Effect.Effect<CalendarPort, SyncError, Scope.Scope>,
  assert: ContractAssertions,
) {
  test(
    "instance identity survives a move",
    Effect.gen(function* () {
      const port = yield* client;
      const calendar = yield* port.create("kb routines", "Asia/Ho_Chi_Minh");
      yield* port.write(calendar, [{ kind: "insert", id: "kb00001", fields: contractEvent() }]);
      const instance = yield* port.instance(
        calendar,
        "kb00001",
        { ...contractEvent().start, day: "2026-11-03" },
        "Asia/Ho_Chi_Minh",
      );
      const fields = instance.fields;
      if (fields === null) return yield* new SyncError({ status: 500, code: "contract_failed" });
      yield* port.write(calendar, [
        {
          kind: "update",
          id: instance.id,
          etag: instance.etag,
          fields: {
            ...fields,
            start: { ...fields.start, day: "2026-11-04" },
            end: { ...fields.end, day: "2026-11-04" },
          },
        },
      ]);
      const same = yield* port.instance(
        calendar,
        "kb00001",
        { ...contractEvent().start, day: "2026-11-03" },
        "Asia/Ho_Chi_Minh",
      );
      assert.equal(same.id, instance.id);
      assert.equal(same.fields?.start.day, "2026-11-04");
      return undefined;
    }),
  );
}
