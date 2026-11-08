/** Only the latest requested reading may publish, even when older work finishes later. */
export function latestRead<Args extends unknown[], A>(
  read: (...args: Args) => Promise<A>,
  publish: (value: A) => void,
): (...args: Args) => Promise<void> {
  let requested = 0;
  return async (...args) => {
    const mine = ++requested;
    const value = await read(...args);
    if (mine === requested) publish(value);
  };
}
