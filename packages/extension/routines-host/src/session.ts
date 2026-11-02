import { Clock, Effect, Option } from "effect";
import { SyncError } from "@kb/routines";
import type { RequestBucket, CalendarBinding, CalendarPort, SyncLedger } from "@kb/routines";
import type { RoutineHost } from "./graph.ts";

export interface AccountLimiter {
  readonly bucket: RequestBucket;
  pauseUntil: number;
}
export interface CalendarSessionOptions {
  readonly binding: CalendarBinding;
  readonly digest: string;
  readonly client: CalendarPort;
  readonly host: RoutineHost;
  readonly ledger: SyncLedger;
  readonly holder: string;
  readonly limiter: AccountLimiter;
}
export class CalendarSession {
  reason = "running";
  private closed = false;
  private readonly options: CalendarSessionOptions;
  constructor(options: CalendarSessionOptions) {
    this.options = options;
  }
  get binding() {
    return this.options.binding;
  }
  get client() {
    return this.options.client;
  }
  get limiter() {
    return this.options.limiter;
  }
  readonly owns = Effect.fn("routines.session.owns")(function* (this: CalendarSession) {
    if (this.closed) return false;
    const at = yield* Clock.currentTimeMillis;
    return yield* this.options.ledger.lease.acquire(
      "calendar:" + this.binding.calendar.id,
      this.options.holder,
      at,
      60_000,
    );
  });
  readonly close = Effect.fn("routines.session.close")(function* (this: CalendarSession) {
    this.closed = true;
    yield* this.options.ledger.lease.release(
      "calendar:" + this.binding.calendar.id,
      this.options.holder,
    );
  });
  private readonly maintain = Effect.fn("routines.session.maintain")(
    function* (this: CalendarSession) {
      yield* Effect.sleep("20 seconds");
      const at = yield* Clock.currentTimeMillis;
      if (
        this.closed ||
        !(yield* this.options.host.trusted(this.options.digest)) ||
        !(yield* this.options.ledger.lease.renew(
          "calendar:" + this.binding.calendar.id,
          this.options.holder,
          at,
          60_000,
        ))
      ) {
        return yield* new SyncError({ status: 409, code: "lease_lost" });
      }
      return undefined;
    },
  );
  readonly call = Effect.fn("routines.session.call")(function* <A>(
    this: CalendarSession,
    maximum: number,
    run: (admitted: number) => Effect.Effect<A, SyncError>,
  ): Effect.fn.Return<Option.Option<A>, SyncError> {
    if (this.closed) return Option.none();
    if (!(yield* this.options.host.trusted(this.options.digest))) {
      this.reason = "untrusted";
      return Option.none();
    }
    const account = this.binding.account?.id ?? this.binding.calendar.id;
    if ((yield* this.options.ledger.cursor.get("auth:" + account)) === "needed") {
      this.reason = "auth needed";
      return Option.none();
    }
    const at = yield* Clock.currentTimeMillis;
    if (this.limiter.pauseUntil > at) {
      this.reason = "quota";
      return Option.none();
    }
    if (!(yield* this.owns())) {
      this.reason = "another runner";
      return Option.none();
    }
    const admitted = this.limiter.bucket.take(at, maximum);
    if (admitted === 0) {
      this.reason = "rate limited";
      return Option.none();
    }
    this.reason = "running";
    return Option.some(yield* Effect.raceFirst(run(admitted), Effect.forever(this.maintain())));
  });
}
