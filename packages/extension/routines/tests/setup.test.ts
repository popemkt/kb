/**
 * The sync-service setup as a state machine over the account node: each
 * transition is the node calls it makes, applied here as the store applies
 * them, and where the wizard stands is read back from the nodes alone, so
 * leaving and coming back resumes at the same step.
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { SYSTEM_IDS, type NodeLike, type PropValue } from "@kb/model";
import {
  addAccount,
  addSetupCalendar,
  chooseProject,
  confirmStep,
  currentStep,
  linkCalendar,
  readAccountSetup,
  routineOption,
  setCalendarSync,
  stepDone,
  stepOpen,
  SETUP_STEPS,
  ROUTINE_FIELDS as F,
  type NodeCall,
} from "../src/index.ts";

type Graph = Map<string, NodeLike>;
const str = (v: string): PropValue => ({ t: "str", v });

const Prop = Schema.Struct({ field: Schema.String, value: Schema.Unknown });
/** What a node call writes, as the store reads its input. */
const Call = Schema.Struct({
  id: Schema.String,
  text: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  props: Schema.optional(Schema.Array(Prop)),
  unsetProps: Schema.optional(Schema.Array(Schema.Struct({ field: Schema.String }))),
  setProps: Schema.optional(Schema.Array(Prop)),
});
const value = (raw: unknown) => raw as PropValue;

/** Apply a node call to `graph` as the store would (add, and update's unset-then-set). */
function apply(graph: Graph, call: NodeCall): void {
  const input = Schema.decodeUnknownSync(Call)(call.input);
  if (call.id === "node.add") {
    const props: Record<string, PropValue[]> = {};
    const tags = input.tags ?? [];
    if (tags.length > 0) props[SYSTEM_IDS.typeField] = tags.map((v) => ({ t: "ref", v }));
    for (const prop of input.props ?? []) (props[prop.field] ??= []).push(value(prop.value));
    graph.set(input.id, { id: input.id, text: input.text ?? "", props, children: [] });
    return;
  }
  const node = graph.get(input.id);
  if (node === undefined) throw new Error("no such node");
  const props: Record<string, readonly PropValue[]> = { ...node.props };
  for (const { field } of input.unsetProps ?? []) delete props[field];
  for (const prop of input.setProps ?? [])
    props[prop.field] = [...(props[prop.field] ?? []), value(prop.value)];
  graph.set(node.id, { ...node, props });
}

function walk() {
  const graph: Graph = new Map();
  apply(graph, addAccount("acct", "Google"));
  const setup = () => {
    const node = graph.get("acct");
    if (node === undefined) throw new Error("no account");
    return readAccountSetup(node, graph);
  };
  /** What the host writes: the client's references, then a connected status. */
  const host = {
    keepClient: () =>
      apply(graph, {
        id: "node.update",
        input: {
          id: "acct",
          setProps: [
            { field: F.clientId, value: str("sealed:routines.acct.client-id") },
            { field: F.clientSecret, value: str("sealed:routines.acct.client-secret") },
            { field: F.refreshToken, value: str("sealed:routines.acct.refresh-token") },
          ],
        },
      }),
    connected: (state: "synced" | "error", message = "") =>
      apply(graph, {
        id: "node.update",
        input: {
          id: "acct",
          unsetProps: [{ field: F.status }, { field: F.message }],
          setProps: [
            { field: F.status, value: { t: "ref", v: routineOption("status", state) } },
            ...(message === "" ? [] : [{ field: F.message, value: str(message) }]),
          ],
        },
      }),
    provisioned: (calendar: string) =>
      apply(graph, {
        id: "node.update",
        input: { id: calendar, setProps: [{ field: F.calendarId, value: str("google-cal") }] },
      }),
  };
  return { graph, setup, host, apply: (call: NodeCall) => apply(graph, call) };
}

describe("sync service setup", () => {
  test("a new service starts at the project, and later steps wait for it", () => {
    const { setup } = walk();
    expect(currentStep(setup())).toBe("project");
    expect(stepOpen(setup(), "project")).toBe(true);
    expect(stepOpen(setup(), "client")).toBe(false);
    expect(SETUP_STEPS.filter((step) => stepDone(setup(), step))).toEqual([]);
  });

  test("the steps advance in order, each from what the nodes hold, and resume there", () => {
    const w = walk();
    w.apply(chooseProject(w.setup(), "kb-routines-me"));
    expect(w.setup().project).toBe("kb-routines-me");
    expect(currentStep(w.setup())).toBe("apis");
    for (const step of ["apis", "branding", "audience"] as const) {
      w.apply(confirmStep(w.setup(), step, true));
      // Read afresh from the nodes: what a page opened later sees.
      expect(stepDone(w.setup(), step)).toBe(true);
    }
    expect(currentStep(w.setup())).toBe("client");
    w.host.keepClient();
    expect(currentStep(w.setup())).toBe("connect");
    w.host.connected("synced");
    expect(currentStep(w.setup())).toBe("calendars");
    w.apply(addSetupCalendar("cal", "acct", "Routines", "Asia/Ho_Chi_Minh"));
    expect(w.setup().calendars).toEqual([
      { id: "cal", name: "Routines", mode: "preview", provisioned: false },
    ]);
    expect(currentStep(w.setup())).toBe("calendars");
    w.host.provisioned("cal");
    w.apply(setCalendarSync("cal", "on"));
    expect(currentStep(w.setup())).toBe("done");
    expect(SETUP_STEPS.every((step) => stepOpen(w.setup(), step))).toBe(true);
  });

  test("another project takes back the steps confirmed about the old one", () => {
    const w = walk();
    w.apply(chooseProject(w.setup(), "kb-routines-me"));
    w.apply(confirmStep(w.setup(), "apis", true));
    w.apply(confirmStep(w.setup(), "branding", true));
    w.apply(chooseProject(w.setup(), "kb-routines-me"));
    expect([...w.setup().confirmed].toSorted()).toEqual(["apis", "branding", "project"]);
    w.apply(chooseProject(w.setup(), "kb-routines-two"));
    expect([...w.setup().confirmed]).toEqual(["project"]);
    expect(currentStep(w.setup())).toBe("apis");
  });

  test("a confirmation taken back reopens its step, and nothing after it is skipped to", () => {
    const w = walk();
    w.apply(chooseProject(w.setup(), "kb-routines-me"));
    for (const step of ["apis", "branding", "audience"] as const)
      w.apply(confirmStep(w.setup(), step, true));
    w.apply(confirmStep(w.setup(), "branding", false));
    expect(currentStep(w.setup())).toBe("branding");
    expect(stepOpen(w.setup(), "audience")).toBe(true);
    expect(stepOpen(w.setup(), "client")).toBe(false);
  });

  test("a failed connection is the account's problem, and connect is not done", () => {
    const w = walk();
    w.host.keepClient();
    w.host.connected("error", "Connecting failed (consent denied)");
    expect(w.setup().connected).toBe(false);
    expect(w.setup().problem).toBe("Connecting failed (consent denied)");
    expect(stepDone(w.setup(), "connect")).toBe(false);
  });

  test("a calendar linked from elsewhere counts, and one on another account does not", () => {
    const w = walk();
    w.apply(addSetupCalendar("mine", "acct", "Mine", "UTC"));
    w.apply(addAccount("other", "Other"));
    w.apply(addSetupCalendar("theirs", "other", "Theirs", "UTC"));
    expect(w.setup().calendars.map((calendar) => calendar.id)).toEqual(["mine"]);
    w.apply(linkCalendar("theirs", "acct"));
    // A ref field holds one value: relinking replaces the account, never adds a second.
    expect(w.graph.get("theirs")?.props[F.account]).toEqual([{ t: "ref", v: "acct" }]);
    expect(w.setup().calendars.map((calendar) => calendar.id)).toEqual(["mine", "theirs"]);
  });
});
