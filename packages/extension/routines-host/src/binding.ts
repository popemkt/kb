import { Effect } from "effect";
import { trustDigest } from "@kb/sandbox";
import type { AccountConfig, CalendarBinding } from "@kb/routines";

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

/**
 * What connecting an account binds: where its client and refresh token are
 * kept, and whose it is. A person trusts it before connecting; the same
 * references in a calendar's binding are trusted again with the calendar.
 */
export const accountBindingDigest = Effect.fn("routines.accountDigest")(function* (
  account: AccountConfig,
) {
  return yield* trustDigest({
    format: "kb.routines.account/1",
    node: account.id,
    email: account.email,
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    refreshToken: account.refreshToken,
  });
});
