import { expect, test } from "bun:test";
import { Effect } from "effect";
import { calendarContract, type EventFields } from "@kb/routines";
import { makeGoogleCalendar } from "../src/index.ts";
/** What each put left, as the contract inspects it. */
const events = new Map<string, EventFields>();
/** What Google holds, as it would list it: each put's body, keyed by calendar and id. */
const held = new Map<string, Record<string, unknown>>();
/** Each instance the lookup handed out: its series and original start. */
const instances = new Map<string, { series: string; originalStart: string }>();
const requests: { method: string; url: URL; headers: Headers }[] = [];
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** A listed event as Google lists it: a cancelled one keeps nothing but its ids. */
function listed(id: string, body: Record<string, unknown>) {
  const instance = instances.get(id);
  const identity = {
    id,
    ...(instance === undefined
      ? {}
      : {
          recurringEventId: instance.series,
          originalStartTime: { dateTime: instance.originalStart },
        }),
  };
  return body.status === "cancelled"
    ? { ...identity, status: "cancelled" }
    : { ...body, ...identity, htmlLink: "https://calendar.test/" + id };
}
const transport = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  requests.push({ method, url, headers: new Headers(init?.headers) });
  if (url.pathname.endsWith("/calendars")) return reply({ id: "calendar" });
  if (url.pathname.endsWith("/instances")) {
    const series = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const id = series + "_instance";
    instances.set(id, { series, originalStart: url.searchParams.get("originalStart") ?? "" });
    return reply({ items: [{ id, htmlLink: "https://calendar.test/" + id }] });
  }
  if (method === "GET" && url.pathname.endsWith("/events"))
    return reply({ items: [...held].map(([key, body]) => listed(key.slice(9), body)) });
  const raw = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
    id: string;
    summary: string;
    status: EventFields["status"];
    start: EventFields["start"];
    end: EventFields["end"];
  };
  const key = "calendar/" + raw.id;
  if (method === "PUT" && !events.has(key) && !instances.has(raw.id)) return reply({}, 404);
  if (method === "POST" && events.has(key)) return reply({}, 409);
  held.set(key, raw);
  events.set(key, {
    title: raw.summary.replace(/^✅ /, ""),
    done: raw.summary.startsWith("✅ "),
    start: raw.start,
    end: raw.end,
    recurrence: [],
    status: raw.status,
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
  expect(requests.every((entry) => !entry.url.searchParams.has("syncToken"))).toBe(true);
  expect(requests.some((entry) => entry.method === "PUT")).toBe(true);
});
test("the list asks for series and exceptions, cancelled ones too, never the plain instances", () => {
  const list = requests.find(
    (entry) => entry.method === "GET" && entry.url.pathname.endsWith("/events"),
  );
  expect(list?.url.searchParams.get("singleEvents")).toBe("false");
  expect(list?.url.searchParams.get("showDeleted")).toBe("true");
});

/** A port whose GETs Google answers with `pages`, one per request, keyed by page token. */
function paged(pages: Readonly<Record<string, unknown>>) {
  const asked: string[] = [];
  const google = makeGoogleCalendar({
    tokens: { access: Effect.succeed("fake"), refresh: Effect.void },
    runner: "test",
    fetch: (async (input: string | URL | Request) => {
      const token = new URL(input instanceof Request ? input.url : input).searchParams.get(
        "pageToken",
      );
      asked.push(token ?? "");
      return reply(pages[token ?? ""]);
    }) as typeof fetch,
  });
  const original = { day: "2026-11-16", at: "07:45", zone: null };
  return {
    asked,
    lookup: google.instance("calendar", "series", original, "Asia/Ho_Chi_Minh"),
    list: google.list("calendar"),
  };
}
test("an instance lookup reads on through the short pages Google hands back", async () => {
  // A done instance is an exception, and Google may hand its page back empty, with a token.
  const { asked, lookup } = paged({
    "": { items: [], nextPageToken: "two" },
    two: { items: [{ id: "series_20261116T004500Z" }], nextPageToken: "three" },
    three: { items: [] },
  });
  expect((await Effect.runPromise(lookup)).id).toBe("series_20261116T004500Z");
  expect(asked).toEqual(["", "two", "three"]);
});
test("an instance lookup that finds two, or never ends, finds none", async () => {
  for (const pages of [
    { "": { items: [{ id: "a" }], nextPageToken: "two" }, two: { items: [{ id: "b" }] } },
    { "": { items: [], nextPageToken: "again" }, again: { items: [], nextPageToken: "again" } },
  ]) {
    const failure = await Effect.runPromise(Effect.flip(paged(pages).lookup));
    expect(["instance_not_found", "pages_unending"]).toContain(failure.code);
  }
});
test("the list reads every page, and leaves out nothing a short page hid", async () => {
  const { asked, list } = paged({
    "": { items: [], nextPageToken: "two" },
    two: { items: [{ id: "a", status: "cancelled" }], nextPageToken: "three" },
    three: { items: [{ id: "b", status: "confirmed" }] },
  });
  expect((await Effect.runPromise(list)).map((event) => event.id)).toEqual(["a", "b"]);
  expect(asked).toEqual(["", "two", "three"]);
});
