import { expect, it } from "vitest";
import { latestRead } from "./latest-read";

it("publishes the latest requested result, independent of completion order", async () => {
  const older = Promise.withResolvers<string>();
  const newer = Promise.withResolvers<string>();
  const seen: string[] = [];
  const read = latestRead(
    (pending: Promise<string>) => pending,
    (value) => seen.push(value),
  );
  const first = read(older.promise);
  const second = read(newer.promise);
  newer.resolve("new");
  await second;
  older.resolve("old");
  await first;
  expect(seen).toEqual(["new"]);
});
