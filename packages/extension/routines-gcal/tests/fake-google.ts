import { Result, Effect, Schema } from "effect";
import { makeFakeCalendar, SyncError, type CalendarMutation, type RemoteEvent } from "@kb/routines";
import { GoogleEvent, decodeTime, decodeEvent, encodeEvent, encodeTime } from "../src/wire.ts";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function wire(event: RemoteEvent) {
  return {
    ...(event.fields === null
      ? { status: "cancelled" }
      : encodeEvent(event.fields, event.runner ?? "fake-server")),
    id: event.id,
    etag: event.etag,
    htmlLink: event.url,
    ...(event.seriesId === null ? {} : { recurringEventId: event.seriesId }),
    ...(event.originalStart === null ? {} : { originalStartTime: encodeTime(event.originalStart) }),
  };
}
function errorResponse(error: SyncError): Response {
  return json(
    {
      error: {
        errors: [{ reason: error.code === "quota" ? "userRateLimitExceeded" : "backendError" }],
      },
    },
    error.status || 503,
  );
}
interface Part {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}
function parseRequest(body: string, contentType: string): readonly Part[] {
  const boundary = contentType.split("boundary=")[1];
  if (boundary === undefined) throw new Error("missing boundary");
  return body
    .split("--" + boundary)
    .slice(1, -1)
    .map((part) => {
      const text = part.trim().replaceAll("\r\n", "\n");
      const head = text.indexOf("\n\n");
      const mime = text.slice(0, head);
      const http = text.slice(head + 2);
      const separator = http.indexOf("\n\n");
      const lines = (separator < 0 ? http : http.slice(0, separator)).split("\n");
      const [method, url] = (lines.shift() ?? "").split(" ");
      const id = /Content-ID:\s*<([^>]+)>/i.exec(mime)?.[1];
      if (method === undefined || url === undefined || id === undefined)
        throw new Error("invalid request");
      const headers = new Headers(
        lines.map((line) => {
          const colon = line.indexOf(":");
          return [line.slice(0, colon), line.slice(colon + 1).trim()];
        }),
      );
      return { id, method, url, headers, body: separator < 0 ? "" : http.slice(separator + 2) };
    });
}
export class FakeGoogle {
  readonly fake = makeFakeCalendar(2);
  readonly requests: { method: string; path: string; ifMatch: string | null }[] = [];
  readonly controls = { outer401: 0, part401: 0, reverse: false };
  private readonly server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => this.handle(request),
  });
  readonly fetch: typeof fetch = Object.assign(
    (input: string | Request | URL, init?: RequestInit) => {
      const original = new URL(input instanceof Request ? input.url : String(input));
      if (original.hostname !== "www.googleapis.com")
        throw new Error("test forbids external requests");
      const local = new URL(
        original.pathname + original.search,
        "http://127.0.0.1:" + this.server.port,
      );
      return fetch(local, init);
    },
    { preconnect: fetch.preconnect },
  );
  close() {
    void this.server.stop(true);
  }
  private async batch(request: Request): Promise<Response> {
    const parts = parseRequest(await request.text(), request.headers.get("Content-Type") ?? "");
    const responses: string[] = [];
    for (const part of parts) {
      let response: Response;
      if (this.controls.part401 > 0) {
        this.controls.part401--;
        response = json({ error: {} }, 401);
      } else {
        response = await this.route(
          part.method,
          new URL(part.url, "https://www.googleapis.com"),
          part.headers,
          part.body,
        );
      }
      responses.push(
        "--response-boundary\r\nContent-Type: application/http\r\nContent-ID: <response-" +
          part.id +
          ">\r\n\r\nHTTP/1.1 " +
          response.status +
          " Result\r\nContent-Type: application/json\r\n\r\n" +
          (await response.text()) +
          "\r\n",
      );
    }
    if (this.controls.reverse) responses.reverse();
    return new Response(responses.join("") + "--response-boundary--\r\n", {
      headers: { "Content-Type": 'multipart/mixed; boundary="response-boundary"' },
    });
  }
  private async handle(request: Request): Promise<Response> {
    if (this.controls.outer401 > 0) {
      this.controls.outer401--;
      return json({ error: {} }, 401);
    }
    if (request.headers.get("Authorization") !== "Bearer fake-access")
      return json({ error: {} }, 401);
    try {
      const at = new URL(request.url);
      return at.pathname === "/batch/calendar/v3"
        ? await this.batch(request)
        : await this.route(request.method, at, request.headers, await request.text());
    } catch {
      return json({ error: {} }, 400);
    }
  }
  private readonly findInstance = Effect.fn("test.findInstance")(function* (
    this: FakeGoogle,
    calendar: string,
    id: string,
    at: URL,
  ) {
    const start = at.searchParams.get("originalStart") ?? "";
    if (at.searchParams.has("timeMin") || at.searchParams.has("timeMax"))
      throw new Error("moved instances must use originalStart");
    const zone = at.searchParams.get("timeZone") ?? "Asia/Ho_Chi_Minh";
    const original = decodeTime(
      /^\d{4}-\d{2}-\d{2}$/.test(start) ? { date: start } : { dateTime: start, timeZone: zone },
    );
    const parent = yield* this.fake.port.get(calendar, id);
    if (
      parent.fields !== null &&
      (original.at !== parent.fields.start.at || original.zone !== parent.fields.start.zone)
    ) {
      return yield* new SyncError({ status: 400, code: "wrong_original_start" });
    }
    const event = yield* this.fake.port.instance(calendar, id, original, zone);
    return event;
  });
  private async route(method: string, at: URL, headers: Headers, body: string): Promise<Response> {
    const path = at.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    this.requests.push({ method, path: at.pathname, ifMatch: headers.get("If-Match") });
    if (at.pathname === "/calendar/v3/calendars" && method === "POST") {
      const data = Schema.decodeUnknownSync(
        Schema.Struct({ summary: Schema.String, timeZone: Schema.String }),
      )(JSON.parse(body));
      return json({
        id: await Effect.runPromise(this.fake.port.create(data.summary, data.timeZone)),
      });
    }
    const calendar = path[3] ?? "";
    const id = path[5] ?? "";
    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(
          function* (this: FakeGoogle) {
            if (path[6] === "instances") {
              const event = yield* this.findInstance(calendar, id, at);
              return json({ items: [wire(event)] });
            }
            if (method === "GET" && id !== "")
              return json(wire(yield* this.fake.port.get(calendar, id)));
            if (method === "GET") {
              const listed = yield* this.fake.port.list(
                calendar,
                at.searchParams.get("syncToken"),
                at.searchParams.get("pageToken"),
              );
              return json({
                items: listed.events.map(wire),
                ...(listed.nextPage === null
                  ? { nextSyncToken: listed.nextToken }
                  : { nextPageToken: listed.nextPage }),
              });
            }
            const raw =
              method === "DELETE"
                ? null
                : Schema.decodeUnknownSync(GoogleEvent)({
                    ...JSON.parse(body),
                    id: id || JSON.parse(body).id,
                  });
            const fields = raw === null ? null : decodeEvent(raw).fields;
            let mutation: CalendarMutation;
            if (method === "DELETE")
              mutation = { kind: "remove", id, etag: headers.get("If-Match") ?? "missing" };
            else {
              if (fields === null || raw === null) return json({ error: {} }, 400);
              mutation =
                method === "POST"
                  ? { kind: "insert", id: raw.id, fields }
                  : { kind: "update", id, fields, etag: headers.get("If-Match") ?? "missing" };
            }
            const outcome = (yield* this.fake.port.write(calendar, [mutation]))[0];
            if (outcome === undefined) return json({ error: {} }, 500);
            if (!outcome.ok) return errorResponse(outcome.error);
            return outcome.event === null
              ? new Response(null, { status: 204 })
              : json(wire(outcome.event));
          }.bind(this),
        ),
      ),
    );
    return Result.isSuccess(result) ? result.success : errorResponse(result.failure);
  }
}
