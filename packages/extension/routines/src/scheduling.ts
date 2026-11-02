export function settleAt(firstTouch: number, lastTouch: number): number {
  return Math.min(lastTouch + 5_000, firstTouch + 30_000);
}
export function pollEvery(attention: "looking" | "open" | "absent"): number {
  return { looking: 20_000, open: 60_000, absent: 300_000 }[attention];
}
export function retryDelay(
  attempt: number,
  jitter: number,
  kind: "quota" | "transport",
  retryAfter = 0,
): number {
  const delay =
    kind === "quota"
      ? Math.min(2 ** Math.min(attempt, 6) * 1_000 + jitter * 1_000, 64_000)
      : Math.min(2 ** Math.min(attempt, 10) * 2_000, 900_000) * jitter;
  return Math.max(delay, retryAfter);
}
export class RequestBucket {
  private tokens = 20;
  private last = 0;
  take(now: number, requested: number): number {
    this.tokens = Math.min(20, this.tokens + (Math.max(0, now - this.last) * 5) / 1_000);
    this.last = Math.max(this.last, now);
    const count = Math.min(Math.floor(this.tokens), requested);
    this.tokens -= count;
    return count;
  }
}
