// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// An event's repeat field reads as its line does (DESIGN-UI.md → The
// routines calendar, an event's repeat field): the rule in words at rest,
// read against the start of the event that holds the field, and the rule
// itself under the caret while it is edited. Screenshots of the fields at
// rest and editing are written beside the run.
import type { APIRequestContext } from "playwright/test";
import { expect, test } from "./harness-test.ts";

// Routines is a family `kb ui` hosts, so these run against `kb ui` itself.
test.use({ harnessOptions: { hosted: true } });

const ROOT = "render.fixture.root";
const RRULE = "sys.f.routines.rrule";
const F = (key: string) => `sys.f.routines.${key}`;
const ref = (v: string) => ({ t: "ref", v });
const str = (v: string) => ({ t: "str", v });

async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output as T;
}

/** The event's rule, as its node holds it. */
async function ruleOf(request: APIRequestContext, id: string): Promise<string | undefined> {
  const { node } = await invoke<{ node: { props: Record<string, { v: string }[]> } }>(
    request,
    "node.get",
    { id, depth: 0 },
  );
  return node.props[RRULE]?.[0]?.v;
}

test("an event's repeat reads in words, and edits as its rule", async ({
  page,
  request,
}, testInfo) => {
  await invoke(request, "extension.switch", { name: "routines", on: true });
  // Tuesday, 2026-11-17: a weekly rule with no day of its own repeats on Tuesdays.
  const gym = await invoke<{ id: string }>(request, "node.add", {
    text: "Gym",
    parent: ROOT,
    props: [
      { field: "sys.f.type", value: ref("sys.tag.routine") },
      { field: F("starts"), value: str("2026-11-17") },
      { field: F("at"), value: str("07:00") },
      { field: RRULE, value: str("FREQ=WEEKLY") },
    ],
  });
  // An event opens in its own box; its fields are the outline's.
  await page.goto(`/node/${gym.id}`);
  await page.getByRole("button", { name: "Open in outline" }).click();
  const values = page.locator(`[data-fields-for="${gym.id}"] [data-field-values="${RRULE}"]`);
  const shown = values.locator("[data-repeat-value]");
  await expect(shown).toHaveText("Weekly on Tue");
  await expect(shown).toHaveAttribute("title", "FREQ=WEEKLY");
  await expect(values).not.toContainText("FREQ=");
  const fields = page.locator(`[data-fields-for="${gym.id}"]`).first();
  await fields.screenshot({ path: testInfo.outputPath("repeat-at-rest.png") });

  // The caret is in the rule itself, and what is typed is the rule stored.
  await shown.click();
  const editor = values.locator('[contenteditable="true"]');
  await expect(editor).toHaveText("FREQ=WEEKLY");
  await fields.screenshot({ path: testInfo.outputPath("repeat-editing.png") });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("FREQ=DAILY");
  await page.keyboard.press("Enter");
  await expect(shown).toHaveText("Daily");
  expect(await ruleOf(request, gym.id)).toBe("FREQ=DAILY");
});
