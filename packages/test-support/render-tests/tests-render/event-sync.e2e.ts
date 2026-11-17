// The calendar hears event sync's statuses from the host that runs it
// (docs/research/2026-11-02-kb-routines-gcal.md → Status lives in the host):
// the page watches the family's channel on its socket, and the host answers
// with what it holds. Nothing is sent here, because no Google account is
// trusted, so nothing is claimed synced. What a sent write shows, and that one
// changed instance waits alone, are the engine's scenarios and the calendar
// page's tests, over the fake calendar.
import type { APIRequestContext, Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

// Routines is a family `kb ui` hosts, so these run against `kb ui` itself.
test.use({ harnessOptions: { hosted: true } });

const ROOT = "render.fixture.root";
const TYPE = "sys.f.type";
const F = (key: string) => `sys.f.routines.${key}`;
const ref = (v: string) => ({ t: "ref", v });
const str = (v: string) => ({ t: "str", v });
const num = (v: number) => ({ t: "num", v });

async function invoke<T>(request: APIRequestContext, id: string, input: unknown): Promise<T> {
  const response = await request.post("/api/action", { data: { id, input } });
  const receipt = (await response.json()) as { status: string; message?: string; output?: T };
  expect(receipt.status, receipt.message).toBe("succeeded");
  return receipt.output as T;
}

type Props = Record<string, unknown[]>;
const props = (all: Props) =>
  Object.entries(all).flatMap(([field, values]) => values.map((value) => ({ field, value })));

/**
 * The routines family on, a calendar that sends (`sync: on`) through an
 * account no one has trusted, and a Gym every day of the week of 2026-11-16.
 */
async function seedSeries(request: APIRequestContext): Promise<string> {
  await invoke(request, "extension.switch", { name: "routines", on: true });
  // An account, so the toolbar reads its status; never trusted, so nothing is sent.
  const account = await invoke<{ id: string }>(request, "node.add", {
    text: "e2e@example.com",
    parent: ROOT,
    props: props({ [TYPE]: [ref("sys.tag.google-account")] }),
  });
  const calendar = await invoke<{ id: string }>(request, "node.add", {
    text: "Personal",
    parent: ROOT,
    props: props({
      [TYPE]: [ref("sys.tag.calendar")],
      [F("sync")]: [ref(`${F("sync")}.on`)],
      [F("calendarId")]: [str("e2e-calendar")],
      [F("account")]: [ref(account.id)],
    }),
  });
  const gym = await invoke<{ id: string }>(request, "node.add", {
    text: "Gym",
    parent: ROOT,
    props: props({
      [TYPE]: [ref("sys.tag.routine")],
      [F("calendar")]: [ref(calendar.id)],
      [F("starts")]: [str("2026-11-16")],
      [F("at")]: [str("07:00")],
      [F("duration")]: [num(60)],
      [F("rrule")]: [str("FREQ=DAILY")],
    }),
  });
  return gym.id;
}

const STATUS_CHANNEL = "routines.status";
const NOTHING_HELD = { series: {}, instances: {}, calendars: {}, held: [] };

/** The `routines.status` frames a page's sockets carry, each way. */
function channelFrames(page: Page): { readonly said: unknown[]; readonly heard: unknown[] } {
  const said: unknown[] = [];
  const heard: unknown[] = [];
  const keep = (into: unknown[]) => (payload: string | Buffer) => {
    const frame = JSON.parse(String(payload)) as { op?: string; channel?: string; data?: unknown };
    if (frame.op === "channel" && frame.channel === STATUS_CHANNEL) into.push(frame.data);
  };
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => keep(said)(payload));
    socket.on("framereceived", ({ payload }) => keep(heard)(payload));
  });
  return { said, heard };
}

const chip = (page: Page, key: string) => page.locator(`[data-entry="${key}"]`).first();

test("the calendar watches the host's sync statuses, and claims nothing synced while nothing is sent", async ({
  page,
  request,
}) => {
  const gym = await seedSeries(request);
  const frames = channelFrames(page);
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  await page.goto("/calendar/week/2026-11-18");
  await expect.poll(() => frames.said, { timeout: 15_000 }).toContainEqual({ watch: true });
  await expect.poll(() => frames.heard, { timeout: 15_000 }).toContainEqual(NOTHING_HELD);
  await expect(page.locator('[data-sync-summary][role="status"]').first()).toHaveText(
    /Not synced yet/,
  );
  await expect(chip(page, `${gym}/2026-11-18`).locator("[data-sync-status]")).toHaveAttribute(
    "title",
    "Not synced yet",
  );
  // A script asks the same host with the status action, and hears the same value.
  expect(await invoke(request, "ext.routines.status", {})).toEqual(NOTHING_HELD);
});
