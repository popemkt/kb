import { expect, test } from "bun:test";
import { requestHealth } from "../src/request-health.ts";

test("a deadline answers once and tracks work until cancellation settles", async () => {
  const reported: string[] = [];
  const health = requestHealth((line) => reported.push(line), 50);
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
    expect(result.headers.get("Retry-After")).toBe("1");
    expect(result.headers.get("Content-Type")).toStartWith("text/plain");
    expect(await result.text()).toBe("Request exceeded the 50 ms deadline.");
    expect(signal.aborted).toBe(true);

    const pending = await health.response().json();
    expect(pending).toMatchObject({ inFlight: 1, oldestRequestMs: expect.any(Number) });

    work.resolve(new Response("late"));
    await health.settle();
    expect(await health.response().json()).toMatchObject({ inFlight: 0, oldestRequestMs: 0 });
    expect(reported.filter((line) => line.includes("deadline"))).toHaveLength(1);
  } finally {
    work.resolve(new Response());
    await health.settle();
  }
});
