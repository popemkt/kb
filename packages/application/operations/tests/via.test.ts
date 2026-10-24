/**
 * The caller's `via` label (`ActionRequest.via`): every wire carries the one a
 * call states, a wire whose process states one labels every call that names
 * none, the envelope sent to another process keeps it, and a call made inside
 * another is made for the outer call's.
 */
import { describe, expect, test } from "bun:test";
import {
  envelopeOf,
  onWire,
  viaOn,
  viaWithin,
  type ActionInvocation,
  type RunningCall,
  type SurfaceWire,
} from "@kb/contracts";
import { callWithin } from "../src/script-reach.ts";

const PROGRAM_WIRE: SurfaceWire = { carriesApproval: false, actor: "agent" };
const LABELLED_WIRE: SurfaceWire = { carriesApproval: true, actor: "cli", via: "job:wire" };

function running(invocation: ActionInvocation): RunningCall {
  return { invocation, action: { id: invocation.id, mode: { kind: "write" } }, depth: 1 };
}

describe("the via a call is made for", () => {
  test("every wire carries the one a call states, and the envelope keeps it", () => {
    const request = { id: "node.add", input: { text: "a" }, via: "job:a" };
    expect(onWire(PROGRAM_WIRE, request).via).toBe("job:a");
    expect(onWire(LABELLED_WIRE, request).via).toBe("job:a");
    expect(envelopeOf(onWire(PROGRAM_WIRE, request))).toEqual(request);
  });

  test("a wire that states one labels every call that names none", () => {
    expect(onWire(LABELLED_WIRE, { id: "node.add", input: {} }).via).toBe("job:wire");
    expect("via" in onWire(PROGRAM_WIRE, { id: "node.add", input: {} })).toBe(false);
  });

  test("a process states one through KB_VIA, trimmed, and none when it is empty or too long", () => {
    expect(viaOn({ KB_VIA: " job:run_1 " })).toEqual({ via: "job:run_1" });
    expect(viaOn({ KB_VIA: "  " })).toEqual({});
    expect(viaOn({ KB_VIA: "x".repeat(257) })).toEqual({});
    expect(viaOn({})).toEqual({});
  });

  test("a call made inside another is made for its via unless it names its own; a script's always", () => {
    const outer = running({ id: "node.add", input: {}, actor: "agent", via: "job:a" });
    expect(callWithin(outer, { id: "node.get", input: {} })?.via).toBe("job:a");
    expect(callWithin(outer, { id: "node.get", input: {}, via: "job:b" })?.via).toBe("job:b");
    const run = running({
      id: "ext.code.script.run",
      input: {},
      actor: "script",
      via: "job:a",
      script: { subject: null, grant: {} },
    });
    expect(callWithin(run, { id: "node.get", input: {}, via: "job:b" })?.via).toBe("job:a");
  });
});

describe("a via prefix", () => {
  test("holds its own label and its parts past a separator, never a longer word", () => {
    expect(viaWithin("job:a", "job:a")).toBe(true);
    expect(viaWithin("job:a:1", "job:a")).toBe(true);
    expect(viaWithin("job:a/1", "job:a")).toBe(true);
    expect(viaWithin("job:ab", "job:a")).toBe(false);
    expect(viaWithin("job:ab", "job:")).toBe(true);
    expect(viaWithin("job:ab", "job")).toBe(true);
    expect(viaWithin("jobs:ab", "job")).toBe(false);
  });
});
