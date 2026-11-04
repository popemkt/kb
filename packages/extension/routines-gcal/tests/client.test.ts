import { expect, test } from "bun:test";
import { Effect } from "effect";
import { calendarContract, type EventFields } from "@kb/routines";
import { makeGoogleCalendar } from "../src/index.ts";
const events = new Map<string, EventFields>();
const requests: { method: string; headers: Headers }[] = [];
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const transport = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  requests.push({ method, headers: new Headers(init?.headers) });

  if (url.pathname.endsWith("/calendars")) return reply({ id: "calendar" });
  if (url.pathname.endsWith("/instances"))
    return reply({
      items: [{ id: "opaque-instance", htmlLink: "https://calendar.test/instance" }],
    });
  const raw = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
    id: string;
    summary: string;
    start: EventFields["start"];
    end: EventFields["end"];
  };
  const key = "calendar/" + raw.id;
  if (method === "PUT" && !events.has(key) && raw.id !== "opaque-instance") return reply({}, 404);
  if (method === "POST" && events.has(key)) return reply({}, 409);
  events.set(key, {
    title: raw.summary.replace(/^✅ /, ""),
    done: raw.summary.startsWith("✅ "),
    start: raw.start,
    end: raw.end,
    recurrence: [],
    status: "confirmed",
    nodeId: "routine",
    unit: "series",
    generation: 0,
    backlink: "",
  });
  return reply({ id: raw.id, htmlLink: "https://calendar.test/" + raw.id });
}) as typeof fetch;
const port = makeGoogleCalendar({
  tokens: { access: Effect.succeed("fake"), refresh: Effect.void },
  runner: "test",
  fetch: transport,
});
calendarContract(
  (name, effect) => test("HTTP: " + name, () => Effect.runPromise(effect)),
  port,
  (calendar, id) => Effect.sync(() => events.get(calendar + "/" + id)),
  (a, b) => expect(a).toEqual(b),
);
test("push never sends If-Match or polls sync tokens", () => {
  expect(requests.every((entry) => !entry.headers.has("If-Match"))).toBe(true);
  expect(requests.some((entry) => entry.method === "PUT")).toBe(true);
});
