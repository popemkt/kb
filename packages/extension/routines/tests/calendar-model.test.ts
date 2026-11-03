import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type NodeLike, type PropValue } from "@kb/model";
import {
  addRoutine,
  calendarEntries,
  describeRepeat,
  editRoutine,
  instantOf,
  moveEntry,
  readRepeat,
  readSyncStatus,
  repeatPresets,
  repeatRule,
  resizeEntry,
  routineOption,
  routineSettings,
  seriesDays,
  setEntryState,
  shiftRule,
  syncStatusProps,
  wallClock,
  ROUTINE_FIELDS as F,
  ROUTINE_TAGS as T,
  type CalendarEntry,
  type NodeCall,
  type Routine,
} from "../src/index.ts";

type Graph = Map<string, NodeLike>;
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}
const str = (v: string): PropValue => ({ t: "str", v });
const ref = (v: string): PropValue => ({ t: "ref", v });

/** The node calls a gesture makes, applied as the store applies them. */
function apply(graph: Graph, calls: readonly NodeCall[]): Graph {
  const next = new Map(graph);
  for (const { id, input } of calls) {
    if (id === "node.add") {
      const {
        props = [],
        tags = [],
        parent,
        text,
      } = input as {
        id: string;
        text: string;
        parent?: string;
        tags?: string[];
        props?: { field: string; value: PropValue }[];
      };
      const nodeProps: Record<string, PropValue[]> = {};
      for (const prop of props) (nodeProps[prop.field] ??= []).push(prop.value);
      if (tags.length > 0) nodeProps[SYSTEM_IDS.typeField] = tags.map(ref);
      const nodeId = String(input["id"]);
      next.set(nodeId, { id: nodeId, text, props: nodeProps, children: [] });
      if (parent !== undefined) {
        const owner = must(next.get(parent));
        next.set(parent, { ...owner, children: [...owner.children, nodeId] });
      }
    } else if (id === "node.update") {
      const change = input as {
        id: string;
        text?: string;
        unsetProps?: { field: string }[];
        setProps?: { field: string; value: PropValue }[];
      };
      const node = must(next.get(change.id));
      const props: Record<string, readonly PropValue[]> = { ...node.props };
      for (const { field } of change.unsetProps ?? []) delete props[field];
      for (const { field, value } of change.setProps ?? [])
        props[field] = [...(props[field] ?? []), value];
      next.set(change.id, { ...node, text: change.text ?? node.text, props });
    } else {
      const doomed = String(input["id"]);
      next.delete(doomed);
      for (const [key, node] of next)
        if (node.children.includes(doomed))
          next.set(key, { ...node, children: node.children.filter((child) => child !== doomed) });
    }
  }
  return next;
}

function routineNode(
  id: string,
  props: Record<string, readonly PropValue[]>,
  children: string[] = [],
): NodeLike {
  return {
    id,
    text: id,
    children,
    props: { [SYSTEM_IDS.typeField]: [ref(T.routine)], ...props },
  };
}
function graphOf(...nodes: NodeLike[]): Graph {
  return new Map(nodes.map((node) => [node.id, node]));
}
let minted = 0;
const mint = () => "minted-" + String(++minted);
const entriesIn = (graph: Graph, from: string, to: string) =>
  calendarEntries(graph, from, to).entries;
const only = (graph: Graph, day: string): CalendarEntry => {
  const found = entriesIn(graph, day, day);
  expect(found).toHaveLength(1);
  return must(found[0]);
};

const base: Routine = {
  id: "r",
  title: "Gym",
  starts: "2026-11-02",
  at: "07:00",
  duration: 60,
  zone: "Asia/Ho_Chi_Minh",
  rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  until: null,
  repeatsFrom: "schedule",
};

describe("series expansion", () => {
  test("a weekly rule's days, bounded by COUNT, by the until field and by the rule's UNTIL", () => {
    expect(seriesDays(base, "2026-11-01", "2026-11-09")).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-06",
      "2026-11-09",
    ]);
    expect(
      seriesDays({ ...base, rrule: base.rrule + ";COUNT=2" }, "2026-11-01", "2026-12-31"),
    ).toEqual(["2026-11-02", "2026-11-04"]);
    expect(seriesDays({ ...base, until: "2026-11-04" }, "2026-11-01", "2026-12-31")).toEqual([
      "2026-11-02",
      "2026-11-04",
    ]);
    expect(
      seriesDays(
        { ...base, rrule: "FREQ=DAILY;UNTIL=20261103T165959Z" },
        "2026-11-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-11-02", "2026-11-03"]);
  });
  test("a one-off is its start; nothing falls before the start", () => {
    expect(seriesDays({ ...base, rrule: "" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-02"]);
    expect(seriesDays({ ...base, rrule: "" }, "2026-11-03", "2026-11-30")).toEqual([]);
    expect(seriesDays({ ...base, rrule: "FREQ=DAILY" }, "2026-10-01", "2026-11-02")).toEqual([
      "2026-11-02",
    ]);
  });
  test("a monthly rule on the last weekday and a yearly rule", () => {
    expect(
      seriesDays(
        { ...base, starts: "2026-10-30", rrule: "FREQ=MONTHLY;BYDAY=-1FR" },
        "2026-10-01",
        "2027-01-31",
      ),
    ).toEqual(["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29"]);
    expect(
      seriesDays(
        { ...base, starts: "2024-02-29", rrule: "FREQ=YEARLY" },
        "2024-01-01",
        "2028-12-31",
      ),
    ).toEqual(["2024-02-29", "2028-02-29"]);
  });
});

describe("calendar entries", () => {
  const zoned = {
    [F.starts]: [str("2026-11-02")],
    [F.at]: [str("07:00")],
    [F.duration]: [{ t: "num", v: 60 } as const],
  };
  test("a series shows each day, a fact changes its day, and skipped and done ones say so", () => {
    const graph = graphOf(
      routineNode("r", { ...zoned, [F.rrule]: [str("FREQ=DAILY")] }, ["o1", "o2", "o3"]),
      {
        id: "o1",
        text: "",
        children: [],
        props: {
          [SYSTEM_IDS.typeField]: [ref(T.occurrence)],
          [F.on]: [str("2026-11-03")],
          [F.state]: [ref(routineOption("state", "done"))],
        },
      },
      {
        id: "o2",
        text: "",
        children: [],
        props: {
          [SYSTEM_IDS.typeField]: [ref(T.occurrence)],
          [F.on]: [str("2026-11-04")],
          [F.state]: [ref(routineOption("state", "skipped"))],
        },
      },
      {
        id: "o3",
        text: "",
        children: [],
        props: {
          [SYSTEM_IDS.typeField]: [ref(T.occurrence)],
          [F.on]: [str("2026-10-30")],
          [F.state]: [ref(routineOption("state", "moved"))],
          [F.movedTo]: [str("2026-11-05")],
          [F.at]: [str("18:30")],
        },
      },
    );
    const shown = entriesIn(graph, "2026-11-02", "2026-11-05");
    expect(shown.map((entry) => [entry.day, entry.at, entry.state, entry.on])).toEqual([
      ["2026-11-02", "07:00", "scheduled", "2026-11-02"],
      ["2026-11-03", "07:00", "done", "2026-11-03"],
      ["2026-11-04", "07:00", "skipped", "2026-11-04"],
      ["2026-11-05", "07:00", "scheduled", "2026-11-05"],
      // Moved in from before the range, after its own day's instance.
      ["2026-11-05", "18:30", "moved", "2026-10-30"],
    ]);
    expect(must(shown[0]).start).toBe(Date.UTC(2026, 10, 2, 0, 0));
    expect(must(shown[0]).end).toBe(Date.UTC(2026, 10, 2, 1, 0));
  });
  test("a routine the engine refuses is an issue, not an entry", () => {
    const { entries, issues } = calendarEntries(
      graphOf(routineNode("bad", { ...zoned, [F.rrule]: [str("FREQ=HOURLY")] })),
      "2026-11-01",
      "2026-11-30",
    );
    expect(entries).toEqual([]);
    expect(issues).toEqual([{ routine: "bad", title: "bad", code: "invalid_rule" }]);
  });
  test("an occurrence's own status wins over its routine's; the status fields round-trip", () => {
    const status = { state: "error" as const, message: "quota", at: "2026-11-02T00:00:00Z" };
    const written = syncStatusProps(status);
    const props = Object.fromEntries(
      Object.entries(written).flatMap(([field, value]) =>
        value === null ? [] : [[field, [value]]],
      ),
    );
    expect(readSyncStatus({ id: "x", text: "", children: [], props })).toEqual(status);
    const graph = graphOf(
      routineNode(
        "r",
        {
          ...zoned,
          [F.rrule]: [str("FREQ=DAILY")],
          [F.status]: [ref(routineOption("status", "synced"))],
        },
        ["o"],
      ),
      {
        id: "o",
        text: "",
        children: [],
        props: {
          [SYSTEM_IDS.typeField]: [ref(T.occurrence)],
          [F.on]: [str("2026-11-03")],
          [F.state]: [ref(routineOption("state", "done"))],
          ...props,
        },
      },
    );
    expect(only(graph, "2026-11-02").status?.state).toBe("synced");
    expect(only(graph, "2026-11-03").status).toEqual(status);
  });
});

describe("a DST week", () => {
  const ny = (props: Record<string, readonly PropValue[]>) =>
    routineNode("r", {
      [F.timezone]: [str("America/New_York")],
      [F.starts]: [str("2026-03-05")],
      ...props,
    });
  test("a daily routine keeps its wall time through spring forward, so its instants are 23 hours apart", () => {
    const graph = graphOf(ny({ [F.at]: [str("09:00")], [F.rrule]: [str("FREQ=DAILY")] }));
    const week = entriesIn(graph, "2026-03-07", "2026-03-09");
    expect(week.map((entry) => wallClock(must(entry.start), "America/New_York"))).toEqual([
      { day: "2026-03-07", minutes: 540 },
      { day: "2026-03-08", minutes: 540 },
      { day: "2026-03-09", minutes: 540 },
    ]);
    expect(must(must(week[1]).start) - must(must(week[0]).start)).toBe(23 * 3_600_000);
  });
  test("an hour and a half from 01:30 ends at 04:00, and a time in the gap moves past it", () => {
    const graph = graphOf(
      ny({
        [F.at]: [str("01:30")],
        [F.duration]: [{ t: "num", v: 90 }],
        [F.rrule]: [str("FREQ=DAILY")],
      }),
    );
    const sunday = only(graph, "2026-03-08");
    expect(wallClock(must(sunday.end), "America/New_York")).toEqual({
      day: "2026-03-08",
      minutes: 240,
    });
    expect(
      wallClock(instantOf("2026-03-08", "02:30", "America/New_York"), "America/New_York").minutes,
    ).toBe(210);
    // Seen from another zone the same instants keep their order and length.
    expect(must(sunday.end) - must(sunday.start)).toBe(90 * 60_000);
  });
});

describe("gestures", () => {
  const start = graphOf(
    routineNode("r", {
      [F.starts]: [str("2026-11-02")],
      [F.at]: [str("07:00")],
      [F.duration]: [{ t: "num", v: 60 }],
      [F.rrule]: [str("FREQ=WEEKLY;BYDAY=MO,WE")],
    }),
  );
  test("create makes one tagged routine that the calendar shows where it was made", () => {
    const graph = apply(new Map(), [
      addRoutine({
        id: "n",
        title: "Read",
        place: { day: "2026-11-05", at: "21:15" },
        duration: 45,
        calendar: "",
        rrule: "",
      }),
    ]);
    const made = only(graph, "2026-11-05");
    expect([made.title, made.at, made.duration, made.series]).toEqual(["Read", "21:15", 45, false]);
    expect(Object.keys(must(graph.get("n")).props)).not.toContain(F.calendar);
  });
  test("moving one instance records it on its fact, and moving it back removes the fact", () => {
    const monday = only(start, "2026-11-02");
    const moved = apply(
      start,
      must(moveEntry(monday, start, { day: "2026-11-03", at: "08:00" }, "one", mint)),
    );
    expect(entriesIn(moved, "2026-11-02", "2026-11-02")).toEqual([]);
    const tuesday = only(moved, "2026-11-03");
    expect([tuesday.on, tuesday.at, tuesday.state]).toEqual(["2026-11-02", "08:00", "moved"]);
    expect(only(moved, "2026-11-04").state).toBe("scheduled");
    const back = apply(
      moved,
      must(moveEntry(tuesday, moved, { day: "2026-11-02", at: "07:00" }, "one", mint)),
    );
    expect(must(back.get("r")).children).toEqual([]);
    expect(only(back, "2026-11-02").state).toBe("scheduled");
  });
  test("moving the series turns its weekdays and its facts with it", () => {
    const done = apply(start, setEntryState(only(start, "2026-11-04"), start, "done", mint));
    const monday = only(done, "2026-11-02");
    const moved = apply(
      done,
      must(moveEntry(monday, done, { day: "2026-11-03", at: "06:30" }, "series", mint)),
    );
    expect(entriesIn(moved, "2026-11-02", "2026-11-08").map((e) => [e.day, e.at, e.state])).toEqual(
      [
        ["2026-11-03", "06:30", "scheduled"],
        ["2026-11-05", "06:30", "done"],
      ],
    );
  });
  test("a series whose rule cannot move by days says so", () => {
    expect(shiftRule("FREQ=MONTHLY;BYDAY=2WE", 1)).toBeNull();
    const monthly = graphOf(
      routineNode("m", {
        [F.starts]: [str("2026-11-11")],
        [F.rrule]: [str("FREQ=MONTHLY;BYDAY=2WE")],
      }),
    );
    expect(
      moveEntry(
        only(monthly, "2026-11-11"),
        monthly,
        { day: "2026-11-12", at: null },
        "series",
        mint,
      ),
    ).toBeNull();
    expect(shiftRule("FREQ=MONTHLY;BYMONTHDAY=10", 2)).toBe("BYMONTHDAY=12;FREQ=MONTHLY");
  });
  test("resize changes the routine's duration", () => {
    const resized = apply(start, resizeEntry(only(start, "2026-11-02"), 90));
    expect(only(resized, "2026-11-04").duration).toBe(90);
  });
  test("done, skip and taking it back; a moved one ticked done stays where it was moved", () => {
    const monday = only(start, "2026-11-02");
    const skipped = apply(start, setEntryState(monday, start, "skipped", mint));
    expect(only(skipped, "2026-11-02").state).toBe("skipped");
    const cleared = apply(skipped, setEntryState(only(skipped, "2026-11-02"), skipped, null, mint));
    expect(must(cleared.get("r")).children).toEqual([]);
    const moved = apply(
      start,
      must(moveEntry(monday, start, { day: "2026-11-03", at: "07:00" }, "one", mint)),
    );
    const done = apply(moved, setEntryState(only(moved, "2026-11-03"), moved, "done", mint));
    expect([only(done, "2026-11-03").state, only(done, "2026-11-03").on]).toEqual([
      "done",
      "2026-11-02",
    ]);
    const undone = apply(done, setEntryState(only(done, "2026-11-03"), done, null, mint));
    expect(only(undone, "2026-11-03").state).toBe("moved");
  });
  test("an edit writes only the fields that changed", () => {
    const before = { title: "r", settings: routineSettings(must(start.get("r"))).settings };
    expect(editRoutine("r", before, before)).toEqual([]);
    const [call] = editRoutine("r", before, {
      title: "Gym",
      settings: { ...before.settings, at: "" },
    });
    expect(must(call).input).toEqual({
      id: "r",
      text: "Gym",
      unsetProps: [{ field: F.at }],
      setProps: [],
    });
  });
});

describe("repeat picker", () => {
  test("presets read back as themselves, and say themselves", () => {
    for (const preset of repeatPresets("2026-11-27")) {
      if (preset.rrule === "") continue;
      const repeat = readRepeat(preset.rrule, "2026-11-27");
      expect(repeat).not.toBeNull();
      expect(repeatRule(must(repeat), "2026-11-27")).toBe(preset.rrule);
      expect(describeRepeat(preset.rrule, "", "2026-11-27")).toBe(preset.label);
    }
    expect(repeatPresets("2026-11-27").map((preset) => preset.label)).toContain(
      "Monthly on the last Fri",
    );
  });
  test("a custom rule names its parts, its count and its end", () => {
    expect(
      describeRepeat("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=6", "2026-12-31", "2026-11-03"),
    ).toBe("Every 2 weeks on Tue, Thu, 6 times, until 2026-12-31");
    expect(describeRepeat("FREQ=YEARLY;BYMONTH=1,7", "", "2026-01-01")).toBe("Custom rule");
    expect(readRepeat("FREQ=WEEKLY;BYDAY=MO", "2026-11-02")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: ["MO"],
      monthly: "day",
      count: null,
    });
  });
});
