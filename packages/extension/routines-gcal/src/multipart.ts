import { SyncError, validateCalendarBatch, type CalendarMutation } from "@kb/routines";
import { encodeEvent } from "./wire.ts";

const invalid = () => new SyncError({ status: 502, code: "invalid_batch_response" });
export function eventPath(calendar: string, id?: string): string {
  return (
    "/calendar/v3/calendars/" +
    encodeURIComponent(calendar) +
    "/events" +
    (id === undefined ? "" : "/" + encodeURIComponent(id))
  );
}
export function multipartBody(
  calendar: string,
  changes: readonly CalendarMutation[],
  runner: string,
  boundary: string,
): string {
  validateCalendarBatch(changes);
  return (
    changes
      .map((change, index) => {
        const method = { insert: "POST", update: "PATCH", remove: "DELETE" }[change.kind];
        const path =
          eventPath(calendar, change.kind === "insert" ? undefined : change.id) +
          "?sendUpdates=none";
        const headers = new Headers({ "Content-Type": "application/json" });
        if (change.kind !== "insert") headers.set("If-Match", change.etag);
        const body =
          change.kind === "remove"
            ? ""
            : JSON.stringify({
                ...encodeEvent(change.fields, runner),
                ...(change.kind === "insert" ? { id: change.id } : {}),
              });
        const lines = [...headers].map(([key, value]) => key + ": " + value);
        return (
          "--" +
          boundary +
          "\r\nContent-Type: application/http\r\nContent-ID: <op" +
          index +
          ">\r\n\r\n" +
          method +
          " " +
          path +
          " HTTP/1.1\r\n" +
          lines.join("\r\n") +
          "\r\n\r\n" +
          body +
          "\r\n"
        );
      })
      .join("") +
    "--" +
    boundary +
    "--\r\n"
  );
}
export interface MultipartResponse {
  readonly index: number;
  readonly response: Response;
}
export function parseMultipart(contentType: string, body: string): readonly MultipartResponse[] {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined) throw invalid();
  const parts: string[][] = [];
  let current: string[] | null = null;
  for (const line of body.replaceAll("\r\n", "\n").split("\n")) {
    if (line === "--" + boundary || line === "--" + boundary + "--") {
      if (current !== null) parts.push(current);
      current = line === "--" + boundary + "--" ? null : [];
    } else if (current !== null) current.push(line);
  }
  return parts.map((lines) => {
    const text = lines.join("\n").trim();
    const mimeEnd = text.indexOf("\n\n");
    const mime = text.slice(0, mimeEnd);
    const id = /content-id:\s*<?(?:response-)?op(\d+)>?/i.exec(mime)?.[1];
    const http = text.slice(mimeEnd + 2);
    const headEnd = http.indexOf("\n\n");
    const header = headEnd < 0 ? http : http.slice(0, headEnd);
    const status = /^HTTP\/[\d.]+\s+(\d{3})/.exec(header)?.[1];
    if (mimeEnd < 0 || id === undefined || status === undefined) throw invalid();
    const headers = new Headers(
      header
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const colon = line.indexOf(":");
          if (colon < 1) throw invalid();
          return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
        }),
    );
    const payload = Number(status) === 204 ? null : headEnd < 0 ? "" : http.slice(headEnd + 2);
    return {
      index: Number(id),
      response: new Response(payload, { status: Number(status), headers }),
    };
  });
}
