import { DateTime, Effect, Schema } from "effect";
import { SyncError, type CalendarPort } from "@kb/routines";
import { googleHttp, readJson, type GoogleTokens } from "./http.ts";
import { encodeEvent } from "./wire.ts";
const Result = Schema.Struct({ id: Schema.String, htmlLink: Schema.optionalKey(Schema.String) });
const invalid = () => new SyncError({ status: 502, code: "invalid_response" });
const path = (calendar: string, id?: string) =>
  "https://www.googleapis.com/calendar/v3/calendars/" +
  encodeURIComponent(calendar) +
  "/events" +
  (id === undefined ? "" : "/" + encodeURIComponent(id));
export function makeGoogleCalendar(options: {
  readonly tokens: GoogleTokens;
  readonly runner: string;
  readonly fetch?: typeof fetch;
}): CalendarPort {
  const http = googleHttp(options.tokens, options.fetch);

  const response = Effect.fn("routines.google.response")(function* (raw: Response) {
    const result = yield* Schema.decodeUnknownEffect(Result)(yield* readJson(raw)).pipe(
      Effect.mapError(invalid),
    );
    return { id: result.id, url: result.htmlLink ?? "" };
  });
  return {
    create: (name, zone) =>
      http.authorize((token) =>
        Effect.gen(function* () {
          const raw = yield* http.send(token, {
            url: "https://www.googleapis.com/calendar/v3/calendars",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ summary: name, timeZone: zone }),
          });
          return (yield* response(raw)).id;
        }),
      ),
    put: (calendar, id, fields) =>
      http.authorize((token) =>
        Effect.gen(function* () {
          const body = JSON.stringify({ ...encodeEvent(fields, options.runner), id });
          const headers = { "Content-Type": "application/json" };
          const raw = yield* http
            .send(token, { url: path(calendar, id), method: "PUT", headers, body })
            .pipe(
              Effect.catchIf(
                (error) => error.status === 404,
                () =>
                  http.send(token, { url: path(calendar), method: "POST", headers, body }).pipe(
                    Effect.catchIf(
                      (error) => error.status === 409,
                      () =>
                        http.send(token, { url: path(calendar, id), method: "PUT", headers, body }),
                    ),
                  ),
              ),
            );
          return yield* response(raw);
        }),
      ),
    instance: (calendar, series, original, calendarZone) =>
      http.authorize((token) =>
        Effect.gen(function* () {
          const zone = original.zone ?? calendarZone;
          const url = new URL(path(calendar, series) + "/instances");
          const start = DateTime.makeZonedUnsafe(original.day + "T" + (original.at ?? "00:00"), {
            timeZone: zone,
            adjustForTimeZone: true,
          });
          url.searchParams.set(
            "originalStart",
            original.at === null ? original.day : DateTime.formatIso(start),
          );
          url.searchParams.set("showDeleted", "true");
          url.searchParams.set("maxResults", "2");
          const raw = yield* http.send(token, { url: url.toString(), method: "GET" });
          const list = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              items: Schema.Array(Result),
              nextPageToken: Schema.optionalKey(Schema.String),
            }),
          )(yield* readJson(raw)).pipe(Effect.mapError(invalid));
          const event = list.items[0];
          if (list.items.length !== 1 || list.nextPageToken !== undefined || event === undefined)
            return yield* new SyncError({ status: 409, code: "instance_not_found" });
          return { id: event.id, url: event.htmlLink ?? "" };
        }),
      ),
  };
}
