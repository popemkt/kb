// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BackdropProps, PageActivity } from "@kb/ui-sdk";
import { BunkerBackdrop } from "./bunker-backdrop";

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterAll(() => vi.useRealTimers());

function props(activity: PageActivity): BackdropProps {
  return {
    color: "red",
    node: undefined,
    strength: "subtle",
    direction: "down",
    opacity: 0.7,
    activity,
    pointer: { now: () => null },
  };
}

describe("the Bunker's head", () => {
  it("never restarts while the owner works: typing keeps the reticle, and a burst of writes is one ping", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let writes = 0;
    const draw = (editing: boolean) => {
      act(() => {
        root.render(<BunkerBackdrop {...props({ editing, writes })} />);
      });
    };
    draw(false);
    // Past the head's arrival, which plays nothing.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const ticks = host.querySelector(".kb-bunker-ring-ticks");

    // 30 keystrokes: writes while editing, which neither ping nor rebuild anything.
    for (let key = 0; key < 30; key++) {
      writes += 1;
      draw(true);
      act(() => {
        vi.advanceTimersByTime(80);
      });
    }
    expect(host.querySelector(".kb-bunker-ping")).toBeNull();
    expect(host.querySelector(".kb-bunker-ring-ticks")).toBe(ticks);

    // The save that ends the edit lands after it closes: still typing, no ping.
    draw(false);
    writes += 1;
    draw(false);
    expect(host.querySelector(".kb-bunker-ping")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // A structural write pings; more writes while it plays fold into it rather than start it over.
    writes += 1;
    draw(false);
    const ping = host.querySelector(".kb-bunker-ping");
    expect(ping).not.toBeNull();
    for (let more = 0; more < 5; more++) {
      act(() => {
        vi.advanceTimersByTime(150);
      });
      writes += 1;
      draw(false);
      expect(host.querySelector(".kb-bunker-ping")).toBe(ping);
    }
    expect(host.querySelector(".kb-bunker-ring-ticks")).toBe(ticks);
    act(() => {
      root.unmount();
    });
  });
});
