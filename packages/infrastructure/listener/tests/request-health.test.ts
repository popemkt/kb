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
      ({ signal }) => {
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

test("a response the handler finished is the answer, even once the clock is past the deadline", async () => {
  const health = requestHealth(() => undefined, 50);
  try {
    const response = await health.run(new Request("http://localhost/mcp"), "/mcp", () => {
      // Synchronous work that holds the timer back past the deadline, then a receipt.
      Bun.sleepSync(120);
      return Promise.resolve(new Response("receipt"));
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("receipt");
  } finally {
    await health.settle();
  }
});

test("past the deadline, a request whose commit may have begun gets an unknown outcome, not a retry", async () => {
  const reported: string[] = [];
  const health = requestHealth((line) => reported.push(line), 50);
  const work = Promise.withResolvers<Response>();
  try {
    const told = await health.run(new Request("http://localhost/mcp"), "/mcp", ({ committing }) => {
      committing(Response.json({ outcome: "unknown" }));
      committing(Response.json({ outcome: "second" }));
      return work.promise;
    });
    expect(told.headers.get("Retry-After")).toBeNull();
    expect(await told.json()).toEqual({ outcome: "unknown" });

    const plain = await health.run(
      new Request("http://localhost/api/action"),
      "/api/action",
      ({ committing }) => {
        committing();
        return work.promise;
      },
    );
    expect(plain.status).toBe(504);
    expect(plain.headers.get("Retry-After")).toBeNull();
    expect(await plain.text()).toContain("graph.changes");
    expect(reported.filter((line) => line.includes("may have begun to commit"))).toHaveLength(2);
  } finally {
    work.resolve(new Response());
    await health.settle();
  }
});
