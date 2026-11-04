import { expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { ROUTINE_FIELDS as F, routineOption } from "@kb/routines";
import type { PropValue } from "@kb/model";
import { makeRoutineHost } from "../src/index.ts";
const Update = Schema.Struct({
  unsetProps: Schema.Array(Schema.Struct({ field: Schema.String })),
  setProps: Schema.Array(
    Schema.Struct({
      field: Schema.String,
      value: Schema.Struct({ t: Schema.Literals(["ref", "str"]), v: Schema.String }),
    }),
  ),
});
test("status writes one native transaction, replaces old values, and identical responses write nothing", async () => {
  const props: Record<string, PropValue[]> = { [F.gcal]: [{ t: "str", v: "old" }] };
  let writes = 0;
  const host = makeRoutineHost({
    root: "/scratch",
    invoke: (request) =>
      Effect.sync(() => {
        if (request.id === "node.get")
          return {
            status: "succeeded",
            id: request.id,
            output: { node: { id: "routine", text: "Morning", props } },
          };
        if (request.id !== "node.update") throw new Error("unexpected request");
        expect(request.via).toBe("ext.routines.sync");
        const change = Schema.decodeUnknownSync(Update)(request.input);
        writes++;
        for (const { field } of change.unsetProps) delete props[field];
        for (const { field, value } of change.setProps) props[field] = [value];
        return { status: "succeeded", id: request.id, output: {} };
      }),
  });
  const status = {
    state: "synced" as const,
    message: "",
    eventId: "google-id",
    url: "https://calendar.test/event",
    at: "2026-11-04T00:00:00Z",
  };
  await Effect.runPromise(host.status("routine", status));
  expect(writes).toBe(1);
  expect(props[F.gcal]).toEqual([{ t: "str", v: status.url }]);
  expect(props[F.status]).toEqual([{ t: "ref", v: routineOption("status", "synced") }]);
  await Effect.runPromise(host.status("routine", status));
  expect(writes).toBe(1);
});
