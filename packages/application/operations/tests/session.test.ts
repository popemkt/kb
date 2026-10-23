/**
 * The tab session a call is made in (DESIGN.md → Action registry → The tab
 * session): every wire carries it, the envelope sent to another process
 * keeps it, and a call made inside another is made in the outer call's.
 */
import { describe, expect, test } from "bun:test";
import {
  PAGE_WIRE,
  envelopeOf,
  onWire,
  type ActionInvocation,
  type RunningCall,
  type SurfaceWire,
} from "@kb/contracts";
import { callWithin } from "../src/script-reach.ts";

const PROGRAM_WIRE: SurfaceWire = { carriesApproval: false, actor: "agent" };

function running(invocation: ActionInvocation): RunningCall {
  return { invocation, action: { id: invocation.id, mode: { kind: "read" } }, depth: 1 };
}

describe("the tab session a call is made in", () => {
  test("every wire carries it, and the envelope keeps it", () => {
    const request = { id: "ui.navigate", input: { route: "/graph" }, session: "tab.a" };
    expect(onWire(PAGE_WIRE, request).session).toBe("tab.a");
    expect(onWire(PROGRAM_WIRE, request).session).toBe("tab.a");
    expect(envelopeOf(onWire(PROGRAM_WIRE, request))).toEqual(request);
    expect(envelopeOf({ id: "ui.screen", input: {} })).toEqual({ id: "ui.screen", input: {} });
  });

  test("a call made inside another is made in its session unless it names its own", () => {
    const outer = running({ id: "node.add", input: {}, actor: "agent", session: "tab.a" });
    expect(callWithin(outer, { id: "node.get", input: {} })?.session).toBe("tab.a");
    expect(callWithin(outer, { id: "node.get", input: {}, session: "tab.b" })?.session).toBe(
      "tab.b",
    );
    const sessionless = running({ id: "node.add", input: {}, actor: "cli" });
    expect(callWithin(sessionless, { id: "node.get", input: {} })).toEqual({
      id: "node.get",
      input: {},
      actor: "cli",
    });
  });

  test("a script's call is made in its run's session, whatever it names", () => {
    const run = running({
      id: "ext.code.script.run",
      input: {},
      actor: "script",
      session: "tab.a",
      script: { subject: null, grant: {} },
    });
    const call = callWithin(run, { id: "node.get", input: {}, session: "tab.b" });
    expect(call?.actor).toBe("script");
    expect(call?.session).toBe("tab.a");
  });
});
