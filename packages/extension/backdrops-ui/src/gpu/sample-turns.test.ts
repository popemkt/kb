import { describe, expect, it } from "vitest";
import { inTurn } from "./sample-turns";

/** A start the test settles by hand (before or after it began), which says when it began. */
function startOf(name: string, log: string[]) {
  const settled = Promise.withResolvers<string>();
  const start = () => {
    log.push(`start ${name}`);
    return settled.promise;
  };
  return { start, settle: () => settled.resolve(name) };
}

/** Every timer already due, and what they settle. */
const nextTask = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe("samples' scenes start in turns", () => {
  it("one at a time: each once the one before has settled", async () => {
    const log: string[] = [];
    const a = startOf("a", log);
    const b = startOf("b", log);
    const signal = new AbortController().signal;
    const first = inTurn(a.start, signal);
    const second = inTurn(b.start, signal);
    await nextTask();
    await nextTask();
    expect(log).toEqual(["start a"]);
    a.settle();
    expect(await first).toBe("a");
    await nextTask();
    await nextTask();
    expect(log).toEqual(["start a", "start b"]);
    b.settle();
    expect(await second).toBe("b");
  });

  it("lets the page's timers run between two starts", async () => {
    const log: string[] = [];
    const a = startOf("a", log);
    const b = startOf("b", log);
    const signal = new AbortController().signal;
    void inTurn(a.start, signal);
    const second = inTurn(b.start, signal);
    await nextTask();
    a.settle();
    // A timer the page set while the first was starting is due before the next turn.
    setTimeout(() => log.push("page timer"), 0);
    b.settle();
    await second;
    expect(log).toEqual(["start a", "page timer", "start b"]);
  });

  it("never starts one whose sample went before its turn, and passes the turn on", async () => {
    const log: string[] = [];
    const a = startOf("a", log);
    const b = startOf("b", log);
    const c = startOf("c", log);
    const gone = new AbortController();
    const kept = new AbortController().signal;
    void inTurn(a.start, kept);
    const left = inTurn(b.start, gone.signal);
    const third = inTurn(c.start, kept);
    gone.abort();
    await nextTask();
    a.settle();
    await expect(left).rejects.toThrow();
    await nextTask();
    await nextTask();
    c.settle();
    expect(await third).toBe("c");
    expect(log).toEqual(["start a", "start c"]);
  });

  it("passes the turn on when a start fails", async () => {
    const log: string[] = [];
    const b = startOf("b", log);
    const signal = new AbortController().signal;
    const failed = inTurn(() => Promise.reject(new Error("no GPU")), signal);
    const next = inTurn(b.start, signal);
    await expect(failed).rejects.toThrow("no GPU");
    await nextTask();
    await nextTask();
    b.settle();
    expect(await next).toBe("b");
  });
});
