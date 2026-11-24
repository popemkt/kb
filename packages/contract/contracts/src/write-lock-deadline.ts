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
