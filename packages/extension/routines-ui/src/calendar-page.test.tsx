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
import { EventView } from "./event-view";
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

function pointer(type: string, target: Element, clientY: number, pointerId = 1): void {
  const event = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY,
    pointerId,
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
    // Typing goes to the focused field, and React hears it there.
    input.focus();
    // Past React's own record of the value, as typing is.
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
    // React-dom came in before this DOM did, so it hears typing by the keys, not `input`.
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "e" }));
  });
}
/** A key pressed where focus is, as a person's is. */
const press = (key: string) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
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
    expect($('[aria-label="Date"]').dataset["value"]).toBe("2026-11-04");
    expect(valueOf('[aria-label="Starts"]')).toBe("09:00");
    expect(valueOf('[aria-label="Ends"]')).toBe("09:30");
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
    expect(valueOf('[aria-label="Ends"]')).toBe("11:45");
    expect($("[data-routine-length]").textContent).toBe("1 h 45 min");
    await click(button("Save"));
    expect(propOf(writes()[0], F.duration)).toEqual([105]);
  });
  test("New starts today at the next half hour for half an hour, or at nine on a week without today", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR]);
    await click(button("New"));
    expect($('[aria-label="Date"]').dataset["value"]).toBe("2026-11-04");
    expect([valueOf('[aria-label="Starts"]'), valueOf('[aria-label="Ends"]')]).toEqual([
      "10:30",
      "11:00",
    ]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Title");
    await click(button("Cancel"));
    open("/calendar/week/2026-11-16", [CALENDAR]);
    await click(button("New"));
    expect($('[aria-label="Date"]').dataset["value"]).toBe("2026-11-16");
    expect(valueOf('[aria-label="Starts"]')).toBe("09:00");
  });
  test("times are typed or picked, the end moves with the start, and what is wrong is said in words", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR]);
    await click(button("New"));
    fill("Starts", "2pm");
    expect([valueOf('[aria-label="Starts"]'), valueOf('[aria-label="Ends"]')]).toEqual([
      "2pm",
      "14:30",
    ]);
    fill("Ends", "1530");
    expect($("[data-routine-length]").textContent).toBe("1 h 30 min");
    fill("Ends", "25:00");
    expect($("[data-editor-problem]").textContent).toBe(
      "The end time isn't a time yet. Type it as 10:00, 1000 or 10pm.",
    );
    expect(button("Save").disabled).toBe(true);
    fill("Ends", "14:00");
    expect($("[data-editor-problem]").textContent).toBe("It has to end after it starts.");
    fill("Ends", "15:00");
    expect(document.querySelector("[data-editor-problem]")).toBeNull();
    // All day hides the times, and switching it off gives the time back.
    await click($('[role="switch"][aria-label="All day"]'));
    expect(document.querySelector('[aria-label="Starts"]')).toBeNull();
    await click($('[role="switch"][aria-label="All day"]'));
    expect(valueOf('[aria-label="Starts"]')).toBe("14:00");
  });
  test("the repeat is said in words only when its option does not already say it", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    await click(button("New"));
    expect(valueOf('select[aria-label="Repeat"]')).toBe("none");
    expect(document.querySelector("[data-repeat-summary]")).toBeNull();
    await click(button("Cancel"));
    pointer("pointerdown", chip("gym/2026-11-02"), y(7) + 10);
    pointer("pointerup", chip("gym/2026-11-02"), y(7) + 10);
    await click(button("Edit event"));
    expect(valueOf('select[aria-label="Repeat"]')).toBe("custom");
    expect($("[data-repeat-summary]").textContent).toBe("Every week on Mon, Wed");
  });
  test("a routine ending at midnight ends the next day, and is drawn on the day it starts", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR]);
    await click(button("New"));
    fill("Title", "Late call");
    fill("Starts", "23:30");
    expect(valueOf('[aria-label="Ends"]')).toBe("00:00");
    expect($("[data-routine-length]").textContent).toBe("30 min, ends the next day");
    fill("Ends", "00:30");
    expect($("[data-routine-length]").textContent).toBe("1 h, ends the next day");
    fill("Ends", "00:00");
    await click(button("Save"));
    expect([propOf(writes()[0], F.at), propOf(writes()[0], F.duration)]).toEqual([["23:30"], [30]]);
    const late = $('button[data-entry$="/2026-11-04"]');
    expect(column("2026-11-04").contains(late)).toBe(true);
    expect(late.getAttribute("aria-label")).toBe("Late call, 23:30–00:00");
    expect(column("2026-11-05").querySelector("[data-entry]")).toBeNull();
  });
  test("an end time is picked from a list that starts after the start, by keys", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR]);
    await click(button("New"));
    const ends = $('[aria-label="Ends"]');
    act(() => ends.focus());
    press("ArrowDown");
    const listed = [...document.querySelectorAll("[data-time-list] [data-time]")];
    expect(listed[0]?.textContent).toBe("10:4515 min");
    expect(document.querySelector('[data-time-list] [aria-selected="true"]')?.textContent).toBe(
      "11:0030 min",
    );
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    expect(document.querySelector("[data-time-list]")).toBeNull();
    expect(valueOf('[aria-label="Ends"]')).toBe("11:30");
    expect($("[data-routine-length]").textContent).toBe("1 h");
    expect($('[data-testid="routine-editor"]')).toBeDefined();
  });
  test("the day is picked from a month by keys, and Escape closes the month before the editor", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR]);
    await click(button("New"));
    await click($('[aria-label="Date"]'));
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-04");
    press("ArrowDown");
    press("ArrowRight");
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-12");
    press("Escape");
    expect(document.querySelector("[data-date-picker]")).toBeNull();
    expect($('[data-testid="routine-editor"]')).toBeDefined();
    await click($('[aria-label="Date"]'));
    press("ArrowDown");
    await click($("[data-date-picker] [data-day]:focus"));
    expect($('[aria-label="Date"]').dataset["value"]).toBe("2026-11-11");
    fill("Title", "Dentist");
    // Enter in a field saves.
    await act(async () => {
      $('[aria-label="Title"]').closest("form")?.requestSubmit();
      await Promise.resolve();
    });
    await settle();
    expect(propOf(writes()[0], F.starts)).toEqual(["2026-11-11"]);
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
  test("a timed instance dropped on a month day keeps the time it shows, read back into its zone", async () => {
    const late = routine("late", "Call", {
      [F.timezone]: [str("America/Los_Angeles")],
      [F.starts]: [str("2026-11-02")],
      [F.at]: [str("23:00")],
      [F.duration]: [num(30)],
    });
    open("/calendar/month/2026-11-04", [CALENDAR, late]);
    // 23:00 in Los Angeles on Nov 2 shows at 14:00 on Nov 3 here; dropped on Nov 4 it is 14:00 then.
    const day = (d: string) => $(`[data-calendar-day="${d}"]`);
    expect(
      chip("late/2026-11-02").closest("[data-calendar-day]")?.getAttribute("data-calendar-day"),
    ).toBe("2026-11-03");
    drag(chip("late/2026-11-02"), 5, day("2026-11-04"), 40);
    await settle();
    expect([propOf(writes()[0], F.starts), propOf(writes()[0], F.at)]).toEqual([
      ["2026-11-03"],
      ["23:00"],
    ]);
  });
  test("a second pointer does not drive the gesture, and leaving the page mid-drag writes nothing", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    pointer("pointerdown", chip("gym/2026-11-02"), y(7) + 10, 1);
    pointer("pointermove", column("2026-11-03"), y(9), 2);
    pointer("pointerup", column("2026-11-03"), y(9), 2);
    expect(document.querySelector('[data-testid="scope-prompt"]')).toBeNull();
    pointer("pointermove", column("2026-11-03"), y(8) + 10, 1);
    act(() => root.unmount());
    pointer("pointerup", document.body, y(8) + 10, 1);
    await settle();
    expect(writes()).toEqual([]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  test("a move to a time that isn't one waits, and says so", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    pointer("pointerdown", chip("gym/2026-11-02"), y(7) + 10);
    pointer("pointerup", chip("gym/2026-11-02"), y(7) + 10);
    await click(button("Move this one…"));
    fill("Move to time", "25:99");
    expect($("[data-move-form]").textContent).toContain("That isn't a time yet.");
    const move = button("Move");
    expect(move.disabled).toBe(true);
    await click(move);
    expect(writes()).toEqual([]);
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
  test("a one-off is ticked done and skipped on its one day, like an instance of a series", async () => {
    const dentist = routine("dentist", "Dentist", {
      [F.starts]: [str("2026-11-04")],
      [F.at]: [str("14:00")],
      [F.duration]: [num(30)],
    });
    open("/calendar/agenda/2026-11-02", [CALENDAR, dentist]);
    const row = () => $('li[data-entry="dentist/2026-11-04"]');
    await click(button("Mark Dentist done"));
    const [add] = writes();
    expect(add?.input["parent"]).toBe("dentist");
    expect([propOf(add, F.on), propOf(add, F.state)]).toEqual([
      ["2026-11-04"],
      [routineOption("state", "done")],
    ]);
    expect(row().dataset["entryState"]).toBe("done");
    await click(button("Mark Dentist not done"));
    expect(writes()[1]?.id).toBe("node.delete");
    await click(button("Skip Dentist"));
    expect(propOf(writes()[2], F.state)).toEqual([routineOption("state", "skipped")]);
    expect(row().dataset["entryState"]).toBe("skipped");
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
    const service = outline("acct", "Google", { [SYSTEM_IDS.typeField]: [ref(T.account)] });
    open("/calendar/week/2026-11-02", [CALENDAR, synced, service]);
    pointer("pointerdown", chip("gym/2026-11-02"), y(7) + 10);
    pointer("pointerup", chip("gym/2026-11-02"), y(7) + 10);
    const link = $('[data-testid="entry-popover"] a');
    expect(link.getAttribute("href")).toBe("https://calendar.google.com/event?eid=x");
    expect(link.getAttribute("target")).toBe("_blank");
    // The status is read, not pressed: Sync now is its own button.
    expect($("[data-sync-summary]").tagName).toBe("SPAN");
    await click($("[data-sync-now]"));
    expect(calls.at(-1)).toEqual({ id: "ext.routines.sync", input: {} });
    await click(button("Sync services"));
    expect(getPath()).toBe("/calendar/sync");
  });
  test("with no sync service, the toolbar offers to set one up", async () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    await click(button("Set up sync"));
    expect(getPath()).toBe("/calendar/sync");
    expect(calls.filter((call) => call.id === "ext.routines.sync")).toEqual([]);
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
  test("a resize across spring forward lasts the time to its new end, not the clock's", async () => {
    zone = "America/New_York";
    const night = routine("night", "Night shift", {
      [F.timezone]: [str("America/New_York")],
      [F.starts]: [str("2026-03-08")],
      [F.at]: [str("01:30")],
      [F.duration]: [num(90)],
    });
    open("/calendar/week/2026-03-08", [CALENDAR, night]);
    // Shown 01:30–04:00; its end dragged to 04:15 is 105 minutes after 01:30, an hour skipped.
    drag($('[data-resize="night/2026-03-08"]'), y(4) - 2, column("2026-03-08"), y(4) + 5);
    await settle();
    expect(propOf(writes()[0], F.duration)).toEqual([105]);
  });
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
  test("the week's header, all-day row and hours are one grid in one scroller", () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    const scroller = $("[data-calendar-scroller]");
    const head = $('[data-calendar-head="2026-11-02"]');
    const allDay = $('[data-calendar-day="2026-11-02"]:not([data-calendar-timed])');
    const timed = $('[data-calendar-day="2026-11-02"][data-calendar-timed]');
    // A scrollbar narrows every row alike only when every row is in the scroller.
    for (const row of [head, allDay, timed]) expect(scroller.contains(row)).toBe(true);
    const columns = new Set(
      [head, allDay, timed].map((cell) => cell.parentElement?.className.split(" ")[1]),
    );
    expect(columns).toEqual(new Set(["grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"]));
  });
  test("the week opens just above seven, or above the hour of anything earlier, and a short one stays readable", () => {
    open("/calendar/week/2026-11-02", [CALENDAR, GYM]);
    const scroller = () => $("[data-calendar-scroller]");
    // A little above the hour, so its label is drawn whole under the header.
    expect(scroller().scrollTop).toBe(7 * HOUR_PX - 10);
    const early = routine("early", "Standup", {
      [F.starts]: [str("2026-11-03")],
      [F.at]: [str("05:45")],
      [F.duration]: [num(15)],
    });
    open("/calendar/week/2026-11-02", [CALENDAR, GYM, early]);
    expect(scroller().scrollTop).toBe(5 * HOUR_PX - 10);
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

/** One event in its own view, on the test's clock. */
function OwnEvent({ id, preview }: { readonly id: string; readonly preview: boolean }) {
  const clock = useMemo(() => ({ zone, now: () => NOW }), []);
  return (
    <CalendarClockContext.Provider value={clock}>
      <EventView id={id} preview={preview} />
    </CalendarClockContext.Provider>
  );
}

/** A box as it reads, its Close button aside: what the popover adds to float it. */
function boxHtml(card: HTMLElement): string {
  const copy = card.cloneNode(true) as HTMLElement;
  copy.querySelector('button[aria-label="Close"]')?.remove();
  return copy.outerHTML;
}

describe("an event on its own", () => {
  /** The event `id` opened in its own view, as a page or as its row's preview. */
  function openEvent(id: string, nodes: readonly OutlineNode[], preview = false): void {
    graph = new Map(nodes.map((node) => [node.id, node]));
    act(() => host.setNodes(graph.values()));
    act(() => root.render(<OwnEvent id={id} preview={preview} />));
  }

  test("is the box the calendar floats over its next instance", async () => {
    open("/calendar/week/2026-11-04", [CALENDAR, GYM]);
    pointer("pointerdown", chip("gym/2026-11-04"), y(7) + 10);
    pointer("pointerup", chip("gym/2026-11-04"), y(7) + 10);
    const floated = boxHtml($('[data-testid="entry-popover"] [data-event-card]'));
    openEvent("gym", [CALENDAR, GYM]);
    const own = $("[data-event-view] [data-event-card]");
    expect(own.dataset["eventCard"]).toBe("gym/2026-11-04");
    expect(boxHtml(own)).toBe(floated);
  });

  test("ticks its instance done through the calendar's actions, and draws it done", async () => {
    openEvent("gym", [CALENDAR, GYM]);
    await click(button("Done"));
    const [add] = writes();
    expect([propOf(add, F.on), propOf(add, F.state)]).toEqual([
      ["2026-11-04"],
      [routineOption("state", "done")],
    ]);
    expect($("[data-event-card] [data-entry-state]").dataset["entryState"]).toBe("done");
    expect(button("Not done")).toBeDefined();
  });

  test("Edit event opens the calendar's editor on the event", async () => {
    openEvent("gym", [CALENDAR, GYM]);
    await click(button("Edit event"));
    expect(valueOf('input[aria-label="Title"]')).toBe("Gym");
    expect($("[data-repeat-summary]").textContent).toBe("Every week on Mon, Wed");
  });

  test("a series that has ended says it has no instance, and can still be edited", async () => {
    const ended = routine("old", "Old class", {
      [F.starts]: [str("2026-10-01")],
      [F.at]: [str("07:00")],
      [F.duration]: [num(60)],
      [F.rrule]: [str("FREQ=DAILY;COUNT=2")],
    });
    openEvent("old", [CALENDAR, ended]);
    expect($("[data-event-card] [data-event-no-instance]")).toBeDefined();
    expect(document.querySelector("[data-event-card] [data-move-form]")).toBeNull();
    await click(button("Edit event"));
    expect(valueOf('input[aria-label="Title"]')).toBe("Old class");
  });

  test("as its row's preview it fills the preview's frame, which draws the edge", () => {
    openEvent("gym", [CALENDAR, GYM], true);
    const card = $("[data-event-view] [data-event-card]");
    expect(card.className).toContain("border-0");
    expect(button("Done")).toBeDefined();
  });
});
