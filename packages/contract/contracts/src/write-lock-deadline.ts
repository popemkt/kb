import { Context } from "effect";

/** The absolute deadline, in Effect clock milliseconds, for acquiring a commit's write lock. */
export const WriteLockDeadline = Context.Reference<number | undefined>(
  "@kb/contracts/WriteLockDeadline",
  { defaultValue: () => undefined },
);
