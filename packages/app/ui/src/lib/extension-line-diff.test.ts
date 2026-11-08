import { expect, it, vi } from "vitest";
import { extensionLineDiff } from "./extension-line-diff";
it("counts changed lines, preserving unchanged runs and the baseline", () => {
  const result = extensionLineDiff({
    name: "hello",
    from: "baseline",
    to: "candidate",
    files: [
      {
        path: "hello.ts",
        from: "same\nold\nend\n",
        to: "same\nnew\nend\n",
        fromMode: "100644",
        toMode: "100644",
      },
    ],
  });
  expect(result).toMatchObject({ from: "baseline", added: 1, removed: 1 });
  expect(
    result.files[0]?.parts.map((p) => ({ value: p.value, added: p.added, removed: p.removed })),
  ).toEqual([
    { value: "same\n", added: false, removed: false },
    { value: "old\n", added: false, removed: true },
    { value: "new\n", added: true, removed: false },
    { value: "end\n", added: false, removed: false },
  ]);
});
it("counts added and deleted files without inventing an empty line", () => {
  const result = extensionLineDiff({
    name: "hello",
    from: null,
    to: "candidate",
    files: [
      { path: "new.ts", from: null, to: "first\nsecond", fromMode: null, toMode: "100644" },
      { path: "old.ts", from: "gone\n", to: null, fromMode: "100644", toMode: null },
    ],
  });
  expect(result).toMatchObject({ added: 2, removed: 1 });
});

it("refuses a review when the total line-diff budget is exhausted", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(1001);
  try {
    expect(() =>
      extensionLineDiff({
        name: "hello",
        from: null,
        to: "candidate",
        files: [{ path: "hello.ts", from: null, to: "hello", fromMode: null, toMode: "100644" }],
      }),
    ).toThrow("computation budget");
  } finally {
    clock.mockRestore();
  }
});
