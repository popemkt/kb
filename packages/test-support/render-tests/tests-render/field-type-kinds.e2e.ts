// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// A field type a family declares (DESIGN.md → Field types), end to end: the
// test kit's example extension, installed and trusted in the scratch root,
// declares stars, which stores as a number, seeds its field `rating`, draws
// a value of it as five stars (its contribution to `ui.value-kinds`), and
// holds every write to one to a whole number from 1 to 5 with its commit
// guard. A press on a star writes the rating through the page's own slot;
// a write out of its form is refused, whichever surface makes it.
import type { APIRequestContext } from "playwright/test";
import { expect, test } from "./harness-test.ts";

test.use({ harnessOptions: { example: true } });

const ROOT = "render.fixture.root";
const RATING = "example.f.rating";

/** Run kb action `id` over the API: its receipt. */
async function call(
  request: APIRequestContext,
  id: string,
  input: unknown,
): Promise<{ status: string; message?: string; output?: unknown }> {
  const response = await request.post("/api/action", { data: { id, input } });
  return (await response.json()) as { status: string; message?: string; output?: unknown };
}

/** The values the store holds for the rating of `id`. */
async function ratingOf(request: APIRequestContext, id: string): Promise<unknown> {
  const receipt = await call(request, "node.get", { id, depth: 0 });
  const { node } = receipt.output as { node: { props: Record<string, unknown> } };
  return node.props[RATING] ?? [];
}

const rate = (id: string, v: number) => ({
  id,
  setProps: [{ field: RATING, value: { t: "num", v } }],
});

test("a family's field type draws its values its own way, and its guard holds their form", async ({
  page,
  request,
}) => {
  const added = await call(request, "node.add", { text: "A rated row", parent: ROOT });
  expect(added.status, added.message).toBe("succeeded");
  const row = (added.output as { id: string }).id;
  expect((await call(request, "node.update", rate(row, 2))).status).toBe("succeeded");
  await page.goto(`/node/${row}`);

  // On its page, the rating is the example's kind: five stars, two of them lit.
  const stars = page.locator('[data-value-slot="example.stars"] [data-example="stars"]');
  await expect(stars).toBeVisible();
  await expect(stars.getByRole("button", { pressed: true })).toHaveCount(2);

  // A press on the fourth sets it, through the slot every value sits in.
  await stars.getByRole("button", { name: "Rate 4" }).click();
  await expect.poll(() => ratingOf(request, row)).toEqual([{ t: "num", v: 4 }]);
  await expect(stars.getByRole("button", { pressed: true })).toHaveCount(4);

  // A number, but no rating: the family's commit guard refuses it on every surface.
  const refused = await call(request, "node.update", rate(row, 9));
  expect(refused.status).toBe("failed");
  expect(refused.message).toContain("a rating is a whole number of stars, 1 to 5");
  expect(await ratingOf(request, row)).toEqual([{ t: "num", v: 4 }]);
});
