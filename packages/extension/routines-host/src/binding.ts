import { Effect } from "effect";
import { trustDigest } from "@kb/sandbox";
import type { CalendarBinding } from "@kb/routines";

/** Only references enter the digest; no credential is resolved while checking it. */
export const calendarBindingDigest = Effect.fn("routines.bindingDigest")(function* (
  binding: CalendarBinding,
) {
  return yield* trustDigest({
    format: "kb.routines/1",
    node: binding.calendar.id,
    adapter: binding.calendar.adapter,
    calendar: binding.calendar.calendarId,
    email: binding.account?.email ?? "",
    clientId: binding.account?.clientId ?? "",
    clientSecret: binding.account?.clientSecret ?? "",
    refreshToken: binding.account?.refreshToken ?? "",
  });
});
