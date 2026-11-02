import { expect, test } from "bun:test";
import { Effect } from "effect";
import { calendarContract, contractEvent, outcomeEvent } from "@kb/routines";
import { makeGoogleCalendar } from "../src/client.ts";
import { FakeGoogle } from "./fake-google.ts";

function client(server: FakeGoogle, refresh: () => void = () => undefined) {
  return makeGoogleCalendar({
    runner: "contract-runner",
    fetch: server.fetch,
    tokens: { access: Effect.succeed("fake-access"), refresh: Effect.sync(refresh) },
  });
}
const fixture = Effect.acquireRelease(
  Effect.sync(() => new FakeGoogle()),
  (server) => Effect.sync(() => server.close()),
).pipe(Effect.map((server) => client(server)));
calendarContract(
  (name, effect) =>
    test("Google HTTP adapter: " + name, () => Effect.runPromise(Effect.scoped(effect))),
  fixture,
  { equal: (a, b) => expect(a).toEqual(b), different: (a, b) => expect(a).not.toEqual(b) },
);
test("outer and multipart 401 each refresh only once; response order is irrelevant", async () => {
  const server = new FakeGoogle();
  let refreshed = 0;
  try {
    const port = client(server, () => {
      refreshed++;
    });
    server.controls.outer401 = 1;
    const calendar = await Effect.runPromise(port.create("kb routines", "Asia/Ho_Chi_Minh"));
    expect(refreshed).toBe(1);
    server.controls.part401 = 1;
    await Effect.runPromise(
      port.write(calendar, [{ kind: "insert", id: "kb00001", fields: contractEvent() }]),
    );
    expect(refreshed).toBe(2);
    server.controls.reverse = true;
    const results = await Effect.runPromise(
      port.write(calendar, [
        { kind: "insert", id: "kb00002", fields: { ...contractEvent(), title: "second" } },
        { kind: "insert", id: "kb00003", fields: { ...contractEvent(), title: "third" } },
      ]),
    );
    expect(results.map((result) => result.id)).toEqual(["kb00002", "kb00003"]);
    const event = outcomeEvent(results);
    expect(event.fields?.title).toBe("second");
  } finally {
    server.close();
  }
});
