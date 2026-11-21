import { onTestFinished } from "bun:test";
import { stderr } from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

const POLL_INTERVAL_MS = 10;

/** Retry while the probe returns undefined, within the calling test's timeout. */
export function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  description: string | (() => string),
): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    onTestFinished(() => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      // Bun has already ended the test. Leave its promise pending so its body
      // cannot resume and an in-flight probe cannot reject the ended test.
      const waitingFor = typeof description === "string" ? description : description();
      stderr.write(`Still waiting for ${waitingFor}\n`);
    });

    function poll(): void {
      void Promise.resolve()
        .then(read)
        .then(
          (value) => {
            if (!pending) return;
            if (value === undefined) {
              // The test completion hook clears this timer.
              // @effect-diagnostics-next-line globalTimers:off
              timer = setTimeout(poll, POLL_INTERVAL_MS);
            } else {
              pending = false;
              resolve(value);
            }
          },
          (error) => {
            if (!pending) return;
            pending = false;
            reject(error);
          },
        );
    }

    poll();
  });
}
