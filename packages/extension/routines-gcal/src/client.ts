import { DateTime, Effect, Schema } from "effect";
import { sentDigest, SyncError, type CalendarPort } from "@kb/routines";
import { googleHttp, readJson, type GoogleTokens } from "./http.ts";
import { decodeEvent, encodeEvent, GoogleEvent } from "./wire.ts";
const Result = Schema.Struct({ id: Schema.String, htmlLink: Schema.optionalKey(Schema.String) });
const invalid = () => new SyncError({ status: 502, code: "invalid_response" });
/**
 * How many pages a read follows before it gives up on Google ending it. The
 * list of kb's own calendar is its series, one-offs and exceptions, 2500 to
 * a page, so a real one ends long before.
 */
const PAGES = 50;
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
  /**
   * Every item of a paged read. Google may hand back a page short, even
   * empty, while more remain, and says so only with a page token, so a read
   * follows each token to the end, or until `enough` says it has its answer.
   * One that never ends fails.
   */
  const pages = Effect.fn("routines.google.pages")(function* <A>(
    token: string,
    url: URL,
    item: Schema.Codec<A, unknown>,
    enough: (items: readonly A[]) => boolean,
  ) {
    const Page = Schema.Struct({
      items: Schema.optionalKey(Schema.Array(item)),
      nextPageToken: Schema.optionalKey(Schema.String),
    });
    const items: A[] = [];
    for (let page = 0; page < PAGES; page++) {
      const raw = yield* http.send(token, { url: url.toString(), method: "GET" });
      const read = yield* Schema.decodeUnknownEffect(Page)(yield* readJson(raw)).pipe(
        Effect.mapError(invalid),
      );
      items.push(...(read.items ?? []));
      if (read.nextPageToken === undefined || enough(items)) return items;
      url.searchParams.set("pageToken", read.nextPageToken);
    }
    return yield* new SyncError({ status: 502, code: "pages_unending" });
  });

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
          const digest = yield* sentDigest(fields);
          const body = JSON.stringify({ ...encodeEvent(fields, options.runner, digest), id });
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
    list: (calendar) =>
      http.authorize((token) =>
        Effect.gen(function* () {
          const url = new URL(path(calendar));
          // Each series, one-off and exception, cancelled ones too: never the
          // instances nobody changed (docs/research/2026-11-02-kb-routines-gcal.md → Two sides).
          url.searchParams.set("singleEvents", "false");
          url.searchParams.set("showDeleted", "true");
          url.searchParams.set("maxResults", "2500");
          const listed = yield* pages(token, url, GoogleEvent, () => false);
          return yield* Effect.try({ try: () => listed.map(decodeEvent), catch: invalid });
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
          // More than one answer is no answer: stop reading at the second.
          const found = yield* pages(token, url, Result, (items) => items.length > 1);
          const event = found[0];
          if (found.length !== 1 || event === undefined)
            return yield* new SyncError({ status: 409, code: "instance_not_found" });
          return { id: event.id, url: event.htmlLink ?? "" };
        }),
      ),
  };
}
