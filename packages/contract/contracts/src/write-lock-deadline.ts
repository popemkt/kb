import { Context } from "effect";

/**
 * The latest time, in Effect clock milliseconds, at which a commit may take
 * its write lock. It caps the wait a write starts when it begins
 * (`WRITE_LOCK_WAIT` from then): a caller can bring that end forward, as a
 * transport answering within its own deadline does, and never push it back.
 */
export const WriteLockDeadline = Context.Reference<number | undefined>(
  "@kb/contracts/WriteLockDeadline",
  { defaultValue: () => undefined },
);

/**
 * Told each time a write takes its lock, the point from which a commit may
 * have begun: a host answering a request past its deadline can then say the
 * outcome is unknown rather than that it is safe to retry.
 */
export const WriteLockTaken = Context.Reference<() => void>("@kb/contracts/WriteLockTaken", {
  defaultValue: () => () => undefined,
});
