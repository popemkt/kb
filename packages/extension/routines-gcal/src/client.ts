import { DateTime, Effect, Schema } from "effect";
import {
  SyncError,
  validateCalendarBatch,
  type CalendarPort,
  type MutationOutcome,
} from "@kb/routines";
import { boundedNetwork, googleHttp, readJson, type GoogleTokens } from "./http.ts";
import { GoogleEvent, decodeEvent } from "./wire.ts";
import { eventPath, multipartBody, parseMultipart } from "./multipart.ts";

const ORIGIN = "https://www.googleapis.com";
const LIST = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(GoogleEvent)),
  nextPageToken: Schema.optionalKey(Schema.String),
  nextSyncToken: Schema.optionalKey(Schema.String),
});
const CALENDAR = Schema.Struct({ id: Schema.String });
const invalid = () => new SyncError({ status: 502, code: "invalid_response" });
const readEvent = Effect.fn("routines.gcal.event")(function* (response: Response) {
  const json = yield* readJson(response);
  const wire = yield* Schema.decodeUnknownEffect(GoogleEvent)(json).pipe(Effect.mapError(invalid));
  return yield* Effect.try({ try: () => decodeEvent(wire), catch: invalid });
});
const readList = Effect.fn("routines.gcal.list")(function* (response: Response) {
  return yield* Schema.decodeUnknownEffect(LIST)(yield* readJson(response)).pipe(
    Effect.mapError(invalid),
  );
});
function url(path: string, params: Readonly<Record<string, string>> = {}): string {
  const result = new URL(path, ORIGIN);
  for (const [key, value] of Object.entries(params)) result.searchParams.set(key, value);
  return result.toString();
}

function calendarWriter(
  http: ReturnType<typeof googleHttp>,
  runner: string,
): CalendarPort["write"] {
  let batchSequence = 0;
  const write: CalendarPort["write"] = Effect.fn("routines.gcal.write")(
    function* (calendar, changes) {
      yield* Effect.try({
        try: () => validateCalendarBatch(changes),
        catch: (error) => (error instanceof SyncError ? error : invalid()),
      });
      if (changes.length === 0) return [];
      const boundary = "kb-routines-" + ++batchSequence;
      const body = yield* Effect.try({
        try: () => multipartBody(calendar, changes, runner, boundary),
        catch: (error) => (error instanceof SyncError ? error : invalid()),
      });
      return yield* http.authorize((token) =>
        Effect.gen(function* () {
          const response = yield* http.send(token, {
            url: url("/batch/calendar/v3"),
            method: "POST",
            body,
            headers: { "Content-Type": "multipart/mixed; boundary=" + boundary },
          });
          const text = yield* boundedNetwork(
            Effect.tryPromise({ try: () => response.text(), catch: invalid }),
          );
          const parts = yield* Effect.try({
            try: () => parseMultipart(response.headers.get("Content-Type") ?? "", text),
            catch: invalid,
          });
          if (
            parts.length !== changes.length ||
            new Set(parts.map((part) => part.index)).size !== changes.length
          )
            return yield* invalid();
          const outcomes: MutationOutcome[] = [];
          for (const part of parts) {
            const change = changes[part.index];
            if (change === undefined) return yield* invalid();
            if (part.response.status === 401)
              return yield* new SyncError({ status: 401, code: "unauthorized" });
            if (!part.response.ok) {
              outcomes.push({
                id: change.id,
                ok: false,
                error: yield* http.responseError(part.response),
              });
            } else {
              outcomes.push({
                id: change.id,
                ok: true,
                event: change.kind === "remove" ? null : yield* readEvent(part.response),
              });
            }
          }
          const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
          return changes
            .map((change) => byId.get(change.id))
            .filter((outcome): outcome is MutationOutcome => outcome !== undefined);
        }),
      );
    },
  );
  return write;
}

function calendarInstances(http: ReturnType<typeof googleHttp>): CalendarPort["instance"] {
  return (calendar, series, original, calendarZone) =>
    http.authorize((token) =>
      Effect.gen(function* () {
        const zone = original.zone ?? calendarZone;
        const start = yield* Effect.try({
          try: () =>
            DateTime.makeZonedUnsafe(original.day + "T" + (original.at ?? "00:00"), {
              timeZone: zone,
              adjustForTimeZone: true,
            }),
          catch: () => new SyncError({ status: 400, code: "invalid_rule" }),
        });
        const found: GoogleEvent[] = [];
        {
          const response = yield* http.send(token, {
            url: url(eventPath(calendar, series) + "/instances", {
              originalStart: original.at === null ? original.day : DateTime.formatIso(start),
              showDeleted: "true",
              maxResults: "2",
              timeZone: zone,
            }),
            method: "GET",
          });
          const listed: typeof LIST.Type = yield* readList(response);
          for (const event of listed.items ?? []) {
            const startInfo = event.originalStartTime;
            if (startInfo === undefined) continue;
            const date =
              startInfo.date ??
              (startInfo.dateTime === undefined
                ? null
                : DateTime.formatIsoDate(
                    DateTime.makeZonedUnsafe(startInfo.dateTime, {
                      timeZone: zone,
                      adjustForTimeZone: !/(Z|[+-]\d{2}:\d{2})$/.test(startInfo.dateTime),
                    }),
                  ));
            if (date === original.day) found.push(event);
          }
          if (listed.nextPageToken !== undefined)
            return yield* new SyncError({ status: 409, code: "ambiguous_instance" });
        }
        if (found.length !== 1)
          return yield* new SyncError({
            status: found.length === 0 ? 404 : 409,
            code: "instance_not_found",
          });
        const event = found[0];
        if (event === undefined) return yield* invalid();
        return yield* Effect.try({ try: () => decodeEvent(event), catch: invalid });
      }),
    );
}

/** Fixed Google endpoints; a fake fetch transport is the only test substitution. */
export function makeGoogleCalendar(options: {
  readonly tokens: GoogleTokens;
  readonly runner: string;
  readonly fetch?: typeof fetch;
}): CalendarPort {
  const http = googleHttp(options.tokens, options.fetch);
  const write = calendarWriter(http, options.runner);

  return {
    create: (name, zone) =>
      http.authorize((token) =>
        Effect.gen(function* () {
          const response = yield* http.send(token, {
            url: url("/calendar/v3/calendars"),
            method: "POST",
            body: JSON.stringify({ summary: name, timeZone: zone }),
            headers: { "Content-Type": "application/json" },
          });
          const calendar = yield* Schema.decodeUnknownEffect(CALENDAR)(
            yield* readJson(response),
          ).pipe(Effect.mapError(invalid));
          return calendar.id;
        }),
      ),
    get: (calendar, id) =>
      http.authorize((token) =>
        http
          .send(token, {
            url: url(eventPath(calendar, id)),
            method: "GET",
          })
          .pipe(Effect.flatMap(readEvent)),
      ),
    write,
    list: (calendar, token, page) =>
      http.authorize((access) =>
        Effect.gen(function* () {
          const response = yield* http
            .send(access, {
              url: url(eventPath(calendar), {
                showDeleted: "true",
                singleEvents: "false",
                maxResults: "2500",
                ...(token === null ? {} : { syncToken: token }),
                ...(page === null ? {} : { pageToken: page }),
              }),
              method: "GET",
            })
            .pipe(
              Effect.mapError((error) =>
                error.status === 410
                  ? new SyncError({ status: 410, code: "invalid_sync_token" })
                  : error,
              ),
            );
          const listed = yield* readList(response);
          const events = yield* Effect.try({
            try: () => (listed.items ?? []).map(decodeEvent),
            catch: invalid,
          });
          const nextPage = listed.nextPageToken ?? null;
          if (nextPage === null && listed.nextSyncToken === undefined) return yield* invalid();
          return {
            events,
            nextPage,
            nextToken: nextPage === null ? (listed.nextSyncToken ?? null) : null,
          };
        }),
      ),
    instance: calendarInstances(http),
  };
}
