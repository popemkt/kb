/**
 * The calendar page over a graph the test holds, written through the page's
 * one invoke path: the host applies each node call to the graph, as a local
 * commit does, and the page draws what the graph then says. So every gesture
 * here (create by click and by drag, move one instance or its series, resize,
 * tick done, skip) is checked by what it wrote and by what is shown after it,
 * never by the component's own state. No Google calendar is involved: the
 * engine's push is behind the invoke path and not part of the page.
 */
import { act, useMemo, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { SYSTEM_IDS, type PropValue } from "@kb/model";
import {
  routineOption,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  syncStatusProps,
  type SyncStatus,
} from "@kb/routines";
import { getPath, setToastSink, subscribePath, syncUiPlugins, type OutlineNode } from "@kb/ui-sdk";
import {
  installDomGlobals,
  testBrowserHost,
  testHostPlugin,
  type InstalledDom,
  type TestBrowserHost,
} from "@kb/ui-test-kit";
import { CalendarPage } from "./calendar-page";
import { CalendarClockContext } from "./clock";
import { HOUR_PX } from "./layout";
import { matchCalendar } from "./routes";

interface Call {
  readonly id: string;
  readonly input: Record<string, unknown>;
}
type Props = Record<string, PropValue[]>;
const str = (v: string): PropValue => ({ t: "str", v });
const ref = (v: string): PropValue => ({ t: "ref", v });
const num = (v: number): PropValue => ({ t: "num", v });

function outline(id: string, text: string, props: Props, children: string[] = []): OutlineNode {
  return {
    id,
    text,
    parentId: null,
    children,
    collapsed: false,
    props,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    tags: [],
  };
}
const routine = (id: string, text: string, props: Props, children: string[] = []) =>
  outline(
    id,
    text,
    { [SYSTEM_IDS.typeField]: [ref(T.routine)], [F.calendar]: [ref("cal")], ...props },
    children,
  );
const CALENDAR = outline("cal", "Personal", {
  [SYSTEM_IDS.typeField]: [ref(T.calendar)],
  [F.sync]: [ref(routineOption("sync", "on"))],
  [F.timezone]: [str("Asia/Ho_Chi_Minh")],
});

let dom: InstalledDom;
let root: Root;
let host: TestBrowserHost;
let graph: Map<string, OutlineNode>;
let calls: Call[];
let toasts: string[];
let zone = "Asia/Ho_Chi_Minh";
const NOW = Date.UTC(2026, 10, 4, 3, 0); // Wed 2026-11-04 10:00 in Ho Chi Minh City

/** One node call applied to the graph, as the page's local commit applies it. */
function apply({ id, input }: Call): void {
  const nodeId = String(input["id"]);
  if (id === "node.delete") {
    graph.delete(nodeId);
    for (const [key, node] of graph)
      graph.set(key, { ...node, children: node.children.filter((child) => child !== nodeId) });
    return;
  }
  const props: Props = { ...graph.get(nodeId)?.props };
  for (const { field } of (input["unsetProps"] ?? []) as { field: string }[]) delete props[field];
  for (const { field, value } of [
    ...((input["props"] ?? []) as { field: string; value: PropValue }[]),
    ...((input["setProps"] ?? []) as { field: string; value: PropValue }[]),
  ])
    props[field] = [...(props[field] ?? []), value];
  const tags = (input["tags"] ?? []) as string[];
  if (tags.length > 0) props[SYSTEM_IDS.typeField] = tags.map(ref);
  const before = graph.get(nodeId);
  graph.set(
    nodeId,
    outline(
      nodeId,
      typeof input["text"] === "string" ? input["text"] : (before?.text ?? ""),
      props,
      before?.children ?? [],
    ),
  );
  const parent = input["parent"];
  if (typeof parent === "string") {
    const owner = graph.get(parent);
    if (owner !== undefined) graph.set(parent, { ...owner, children: [...owner.children, nodeId] });
  }
}

function Routed() {
  const params = matchCalendar(useSyncExternalStore(subscribePath, getPath)) ?? {};
  const clock = useMemo(() => ({ zone, now: () => NOW }), []);
  return (
    <CalendarClockContext.Provider value={clock}>
      <CalendarPage params={params} />
    </CalendarClockContext.Provider>
  );
}

function open(path: string, nodes: readonly OutlineNode[]): void {
  graph = new Map(nodes.map((node) => [node.id, node]));
  act(() => host.setNodes(graph.values()));
  window.history.pushState({}, "", path);
  act(() => root.render(<Routed />));
}

const $ = (selector: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
};
/** The value a form control under `selector` holds now. */
const valueOf = (selector: string): string => {
  const found = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found.value;
};
const column = (day: string) => $(`[data-calendar-day="${day}"][data-calendar-timed]`);
const chip = (key: string) => $(`button[data-entry="${key}"]`);
const y = (hours: number) => hours * HOUR_PX;

function pointer(type: string, target: Element, clientY: number): void {
  const event = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY,
  });
  act(() => {
    target.dispatchEvent(event);
  });
}
/** Press `from`, travel over `to`, let go: a drag the way a person makes one. */
function drag(from: Element, fromY: number, to: Element, toY: number): void {
  pointer("pointerdown", from, fromY);
  pointer("pointermove", to, toY);
  pointer("pointerup", to, toY);
}
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(() => Promise.resolve());
}
async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
  await settle();
}
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (each) => each.textContent.trim() === name || each.getAttribute("aria-label") === name,
  );
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}
function fill(label: string, value: string): void {
  const input = $(`input[aria-label="${label}"]`);
  act(() => {
    // Past React's own record of the value, as typing is.
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
    // React-dom came in before this DOM did, so it hears typing by the keys, not `input`.
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "e" }));
  });
}
const writes = () => calls.filter((call) => call.id.startsWith("node."));
const propOf = (call: Call | undefined, field: string) =>
  [
    ...((call?.input["props"] ?? []) as { field: string; value: PropValue }[]),
    ...((call?.input["setProps"] ?? []) as { field: string; value: PropValue }[]),
  ]
    .filter((prop) => prop.field === field)
    .map((prop) => prop.value.v);

const GYM = routine("gym", "Gym", {
  [F.starts]: [str("2026-11-02")],
  [F.at]: [str("07:00")],
  [F.duration]: [num(60)],
  [F.rrule]: [str("FREQ=WEEKLY;BYDAY=MO,WE")],
});

beforeAll(() => {
  dom = installDomGlobals("https://kb.test/");
  const g = globalThis as Record<string, unknown>;
  g["IS_REACT_ACT_ENVIRONMENT"] = true;
  g["PointerEvent"] = dom.window.PointerEvent;
  setToastSink((message) => toasts.push(message));
});
afterAll(() => dom.restore());
beforeEach(() => {
  zone = "Asia/Ho_Chi_Minh";
  calls = [];
  toasts = [];
  host = testBrowserHost({
    invoke: (id, input) => {
      const call = { id, input: input as Record<string, unknown> };
      calls.push(call);
      if (id.startsWith("node.")) {
        apply(call);
        host.setNodes(graph.values());
      }
      return Promise.resolve({ status: "succeeded", id, output: {} });
    },
  });
  act(() => syncUiPlugins([testHostPlugin(host)]));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  syncUiPlugins([]);
});

describe("creating", () => {
  test("a click on an empty slot opens a new routine there, and saving makes it", async () => {
    open("/calendar/week/2026-11-04", [CALENDAR]);
    pointer("pointerdown", column("2026-11-04"), y(9) + 10);
    pointer("pointerup", column("2026-11-04"), y(9) + 10);
    expect(valueOf('[aria-label="Date"]')).toBe("2026-11-04");
    expect(valueOf('[aria-label="Time"]')).toBe("09:00");
    expect(valueOf('select[aria-label="Calendar"]')).toBe("cal");
    fill("Title", "Read");
    await click(button("Save"));
    const [add] = writes();
    expect(add?.id).toBe("node.add");
    expect(add?.input["tags"]).toEqual([T.routine]);
    expect([propOf(add, F.starts), propOf(add, F.at), propOf(add, F.duration)]).toEqual([
      ["2026-11-04"],
      ["09:00"],
      [30],
    ]);
    expect(document.querySelector('[data-testid="routine-editor"]')).toBeNull();
    expect(column("2026-11-04").textContent).toContain("Read");
  });
  test("a drag across slots makes it last as long as the drag", async () => {
    open("/calendar/week/2026-11-04", [CALENDAR]);
    drag(column("2026-11-05"), y(10) + 5, column("2026-11-05"), y(11.5) + 5);
    expect(valueOf('[aria-label="Duration in minutes"]')).toBe("105");
    await click(button("Save"));
    expect(propOf(writes()[0], F.duration)).toEqual([105]);
  });
});

describe("moving and resizing", () => {
  test("dragging a repeating instance asks first; just this one is moved on its fact", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    drag(chip("gym/2026-11-02"), y(7) + 10, column("2026-11-03"), y(8) + 10);
    expect($('[data-testid="scope-prompt"]').textContent).toContain("Just this one");
    await click(button("Just this one"));
    const [add] = writes();
    expect(add?.input["parent"]).toBe("gym");
    expect([
      propOf(add, F.on),
      propOf(add, F.state),
      propOf(add, F.movedTo),
      propOf(add, F.at),
    ]).toEqual([["2026-11-02"], [routineOption("state", "moved")], ["2026-11-03"], ["08:00"]]);
    expect(column("2026-11-02").querySelector("[data-entry]")).toBeNull();
    expect(
      chip("gym/2026-11-02").closest("[data-calendar-day]")?.getAttribute("data-calendar-day"),
    ).toBe("2026-11-03");
    expect(chip("gym/2026-11-04").dataset["entryState"]).toBe("scheduled");
  });
  test("the whole series moves its start, its weekdays and its time", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    drag(chip("gym/2026-11-02"), y(7) + 10, column("2026-11-03"), y(8) + 10);
    await click(button("The whole series"));
    const [update] = writes();
    expect(update?.id).toBe("node.update");
    expect([propOf(update, F.starts), propOf(update, F.at), propOf(update, F.rrule)]).toEqual([
      ["2026-11-03"],
      ["08:00"],
      ["BYDAY=TH,TU;FREQ=WEEKLY"],
    ]);
    expect(document.querySelectorAll("button[data-entry]")).toHaveLength(2);
    expect(
      chip("gym/2026-11-05").closest("[data-calendar-day]")?.getAttribute("data-calendar-day"),
    ).toBe("2026-11-05");
  });
  test("a one-off moves without asking", async () => {
    const dentist = routine("dentist", "Dentist", {
      [F.starts]: [str("2026-11-04")],
      [F.at]: [str("14:00")],
      [F.duration]: [num(30)],
    });
    open("/calendar/week/2026-11-02", [CALENDAR, dentist]);
    drag(chip("dentist/2026-11-04"), y(14) + 5, column("2026-11-06"), y(15) + 5);
    await settle();
    expect(document.querySelector('[data-testid="scope-prompt"]')).toBeNull();
    expect([propOf(writes()[0], F.starts), propOf(writes()[0], F.at)]).toEqual([
      ["2026-11-06"],
      ["15:00"],
    ]);
  });
  test("dragging an instance's lower edge changes how long the routine lasts", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    drag($('[data-resize="gym/2026-11-04"]'), y(8), column("2026-11-04"), y(8) + 20);
    await settle();
    expect(propOf(writes()[0], F.duration)).toEqual([90]);
    expect(chip("gym/2026-11-02").parentElement?.style.height).toBe(`${String(1.5 * HOUR_PX)}px`);
  });
});

describe("occurrences", () => {
  test("ticking one done makes its fact, draws it done, and ticking again takes it back", async () => {
    open("/calendar/agenda/2026-11-02", [CALENDAR, GYM]);
    await click(button("Mark Gym done"));
    const [add] = writes();
    expect([propOf(add, F.on), propOf(add, F.state)]).toEqual([
      ["2026-11-02"],
      [routineOption("state", "done")],
    ]);
    const row = $('li[data-entry="gym/2026-11-02"]');
    expect(row.dataset["entryState"]).toBe("done");
    expect(row.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector(".line-through")).not.toBeNull();
    await click(button("Mark Gym not done"));
    expect(writes()[1]?.id).toBe("node.delete");
    expect($('li[data-entry="gym/2026-11-02"]').dataset["entryState"]).toBe("scheduled");
  });
  test("skipping one marks it skipped and leaves the others", async () => {
    open("/calendar/agenda/2026-11-02", [CALENDAR, GYM]);
    const skip = $('li[data-entry="gym/2026-11-04"] button[aria-label="Skip Gym"]');
    await click(skip);
    expect(propOf(writes()[0], F.state)).toEqual([routineOption("state", "skipped")]);
    expect($('li[data-entry="gym/2026-11-04"]').dataset["entryState"]).toBe("skipped");
    expect($('li[data-entry="gym/2026-11-02"]').dataset["entryState"]).toBe("scheduled");
  });
  test("a done instance in the week is drawn done and is not moved by a drag", async () => {
    const fact = outline("done-1", "2026-11-02", {
      [SYSTEM_IDS.typeField]: [ref(T.occurrence)],
      [F.on]: [str("2026-11-02")],
      [F.state]: [ref(routineOption("state", "done"))],
    });
    open("/calendar/week/2026-11-02", [CALENDAR, { ...GYM, children: ["done-1"] }, fact]);
    expect(chip("gym/2026-11-02").className).toContain("line-through");
    drag(chip("gym/2026-11-02"), y(7) + 10, column("2026-11-03"), y(8) + 10);
    await settle();
    expect(writes()).toEqual([]);
    expect(toasts.at(-1)).toContain("take that back");
  });
});

/** The status fields the engine writes for `state`, as a node holds them. */
const status = (state: SyncStatus): Props =>
  Object.fromEntries(
    Object.entries(syncStatusProps(state)).flatMap(([field, value]) =>
      value === null ? [] : [[field, [value]]],
    ),
  );

describe("sync status", () => {
  test("each instance shows its routine's dot, or its occurrence's own, with the message as its tooltip", () => {
    const failed = outline("o-fail", "2026-11-04", {
      [SYSTEM_IDS.typeField]: [ref(T.occurrence)],
      [F.on]: [str("2026-11-04")],
      [F.state]: [ref(routineOption("state", "done"))],
      ...status({ state: "error", message: "quota_exceeded" }),
    });
    const synced = {
      ...GYM,
      props: {
        ...GYM.props,
        ...status({
          state: "synced",
          message: "",
          at: "2026-11-04T02:00:00Z",
          url: "https://calendar.google.com/event?eid=x",
        }),
      },
      children: ["o-fail"],
    };
    open("/calendar/week/2026-11-02", [CALENDAR, synced, failed]);
    const monday = chip("gym/2026-11-02").querySelector<HTMLElement>("[data-sync-status]");
    expect(monday?.dataset["syncStatus"]).toBe("synced");
    expect(monday?.title).toBe("Synced to Google Calendar at 2026-11-04T02:00:00Z");
    const wednesday = chip("gym/2026-11-04").querySelector<HTMLElement>("[data-sync-status]");
    expect(wednesday?.dataset["syncStatus"]).toBe("error");
    expect(wednesday?.title).toBe("Sync failed — quota_exceeded");
    expect($("[data-sync-summary]").dataset["syncSummary"]).toBe("error");
  });
  test("opening one links to Google Calendar, and Sync now asks the engine", async () => {
    const synced = {
      ...GYM,
      props: {
        ...GYM.props,
        ...status({ state: "synced", message: "", url: "https://calendar.google.com/event?eid=x" }),
      },
    };
    open("/calendar/week/2026-11-02", [CALENDAR, synced]);
    pointer("pointerdown", chip("gym/2026-11-02"), y(7) + 10);
    pointer("pointerup", chip("gym/2026-11-02"), y(7) + 10);
    const link = $('[data-testid="entry-popover"] a');
    expect(link.getAttribute("href")).toBe("https://calendar.google.com/event?eid=x");
    expect(link.getAttribute("target")).toBe("_blank");
    await click($("[data-sync-summary]"));
    expect(calls.at(-1)).toEqual({ id: "ext.routines.sync", input: {} });
  });
  test("a calendar in preview or paused sends nothing, whatever status the engine last wrote", () => {
    const sync = (mode: string) => ({
      ...CALENDAR,
      props: { ...CALENDAR.props, [F.sync]: [ref(routineOption("sync", mode))] },
    });
    const pending = {
      ...GYM,
      props: { ...GYM.props, ...status({ state: "pending", message: "" }) },
    };
    open("/calendar/week/2026-11-02", [sync("preview"), GYM]);
    const dot = () => chip("gym/2026-11-02").querySelector<HTMLElement>("[data-sync-status]");
    expect(dot()?.title).toBe("Not synced: the calendar is in preview");
    open("/calendar/week/2026-11-02", [sync("paused"), pending]);
    expect([dot()?.dataset["syncStatus"], dot()?.title]).toEqual([
      "none",
      "Not synced: the calendar is paused",
    ]);
    expect($("[data-sync-summary]").dataset["syncSummary"]).toBe("none");
  });
});

describe("a DST week", () => {
  test("in New York a daily 09:00 keeps its row across spring forward, and 01:30 for 90 minutes ends at 04:00", () => {
    zone = "America/New_York";
    const ny = {
      [F.timezone]: [str("America/New_York")],
      [F.starts]: [str("2026-03-01")],
      [F.rrule]: [str("FREQ=DAILY")],
    };
    open("/calendar/week/2026-03-08", [
      CALENDAR,
      routine("stretch", "Stretch", { ...ny, [F.at]: [str("09:00")], [F.duration]: [num(30)] }),
      routine("night", "Night shift", { ...ny, [F.at]: [str("01:30")], [F.duration]: [num(90)] }),
    ]);
    for (const day of ["2026-03-06", "2026-03-07", "2026-03-08"])
      expect(chip(`stretch/${day}`).parentElement?.style.top).toBe(`${String(9 * HOUR_PX)}px`);
    const sunday = chip("night/2026-03-08");
    expect(sunday.getAttribute("aria-label")).toBe("Night shift, 01:30–04:00");
    expect(sunday.parentElement?.style.height).toBe(`${String(2.5 * HOUR_PX)}px`);
    expect(chip("night/2026-03-07").getAttribute("aria-label")).toBe("Night shift, 01:30–03:00");
  });
});

describe("the page", () => {
  test("the week opens at seven, or at the hour of anything earlier, and a short one stays readable", () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    const scroller = () => $('[data-calendar-layout="week"] .overflow-y-auto');
    expect(scroller().scrollTop).toBe(7 * HOUR_PX);
    const early = routine("early", "Standup", {
      [F.starts]: [str("2026-11-03")],
      [F.at]: [str("05:45")],
      [F.duration]: [num(15)],
    });
    open("/calendar/week/2026-11-02", [CALENDAR, GYM, early]);
    expect(scroller().scrollTop).toBe(5 * HOUR_PX);
    const short = chip("early/2026-11-03");
    expect(short.parentElement?.style.height).toBe(`${String((25 / 60) * HOUR_PX)}px`);
    expect(short.className).toContain("items-center");
    expect(short.textContent).toBe("05:45Standup");
  });
  test("keys switch layouts and step through days", () => {
    open("/calendar/week/2026-11-04", [CALENDAR, GYM]);
    const page = $('[data-testid="routines-calendar"]');
    const key = (k: string) =>
      act(() => {
        page.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
      });
    key("m");
    expect(window.location.pathname).toBe("/calendar/month/2026-11-04");
    expect(page.dataset["calendarMode"]).toBe("month");
    key("j");
    expect(window.location.pathname).toBe("/calendar/month/2026-12-01");
    expect($("[data-calendar-title]").textContent).toBe("December 2026");
    key("t");
    key("a");
    expect(window.location.pathname).toBe("/calendar/agenda/2026-11-04");
  });
  test("a phone opens on the agenda", () => {
    dom.window.happyDOM.setViewport({ width: 390, height: 844 });
    try {
      open("/calendar", [CALENDAR, GYM]);
      expect($('[data-testid="routines-calendar"]').dataset["calendarMode"]).toBe("agenda");
      expect($('[data-calendar-layout="agenda"]').textContent).toContain("Gym");
      expect($("[data-sync-summary]").textContent).toBe("Sync");
    } finally {
      dom.window.happyDOM.setViewport({ width: 1024, height: 768 });
    }
    open("/calendar", [CALENDAR, GYM]);
    expect($('[data-testid="routines-calendar"]').dataset["calendarMode"]).toBe("week");
  });
});
