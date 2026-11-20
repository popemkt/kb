import { expect, spyOn, test } from "bun:test";
import { requestHealth } from "../src/request-health.ts";

test("a deadline answers once and tracks work until cancellation settles", async () => {
  const health = requestHealth(50);
  const stderr = spyOn(process.stderr, "write");
  const work = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<AbortSignal>();
  try {
    const response = health.run(
      new Request("http://localhost/api/action"),
      "/api/action",
      (signal) => {
        started.resolve(signal);
        return work.promise;
      },
    );
    const signal = await started.promise;
    expect(await health.response().json()).toMatchObject({ inFlight: 1 });

    const result = await response;
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ code: "timeout" });
    expect(signal.aborted).toBe(true);

    const pending = await health.response().json();
    expect(pending).toMatchObject({ inFlight: 1, oldestRequestMs: expect.any(Number) });

    work.resolve(new Response("late"));
    await health.settle();
    expect(await health.response().json()).toMatchObject({ inFlight: 0, oldestRequestMs: 0 });
    expect(stderr.mock.calls.filter(([line]) => String(line).includes("deadline"))).toHaveLength(1);
  } finally {
    work.resolve(new Response());
    await health.settle();
    stderr.mockRestore();
  }
});
