export function settleAt(firstTouch: number, lastTouch: number): number {
  return Math.min(lastTouch + 5_000, firstTouch + 30_000);
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
