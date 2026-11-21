/** Assign each whole spec to the lightest shard, starting with the slowest. */
export function renderShard(
  files: readonly string[],
  durations: Readonly<Partial<Record<string, number>>>,
  selection: string,
): string[] {
  const parts = /^([1-9]\d*)\/([1-9]\d*)$/.exec(selection);
  const shard = Number(parts?.[1]);
  const count = Number(parts?.[2]);
  if (parts === null || shard > count || count > files.length) {
    throw new Error(`Invalid KB_RENDER_SHARD: ${selection} for ${files.length} render specs`);
  }

  const measured = files
    .flatMap((file) => {
      const duration = durations[file];
      return duration === undefined ? [] : [duration];
    })
    .toSorted((a, b) => a - b);
  const fallback = measured[Math.floor(measured.length / 2)] ?? 1;
  const ranked = files.toSorted().map((file) => ({ file, duration: durations[file] ?? fallback }));
  ranked.sort((a, b) => b.duration - a.duration);

  const shards = Array.from({ length: count }, () => ({ files: [] as string[], duration: 0 }));
  for (const { file, duration } of ranked) {
    const lightest = shards.reduce((a, b) => (a.duration <= b.duration ? a : b));
    lightest.files.push(file);
    lightest.duration += duration;
  }
  return shards[shard - 1]?.files ?? [];
}
