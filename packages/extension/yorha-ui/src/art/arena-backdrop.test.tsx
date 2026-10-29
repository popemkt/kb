// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QUIET_ACTIVITY, syncUiPlugins, type BackdropProps, type PageActivity } from "@kb/ui-sdk";
import { testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import type { ArenaScene } from "./arena-scene";

/** The scene the host mounts, standing in for the GPU one: it counts what it is told. */
const told = { mounts: 0, writes: 0, editing: [] as boolean[], disposed: 0 };
vi.mock("./arena-scene", () => ({
  mountArena: (): Promise<ArenaScene> => {
    told.mounts += 1;
    return Promise.resolve({
      backend: "WebGL2",
      resize: () => undefined,
      setRunning: () => undefined,
      setReducedMotion: () => undefined,
      dispose: () => {
        told.disposed += 1;
      },
      setLook: () => undefined,
      write: () => {
        told.writes += 1;
      },
      setEditing: (editing) => {
        told.editing.push(editing);
      },
      setPointer: () => undefined,
    });
  },
}));

const { ArenaBackdrop } = await import("./arena-backdrop");

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  syncUiPlugins([testHostPlugin(testBrowserHost())]);
});
afterAll(() => {
  syncUiPlugins([]);
});

function props(activity: PageActivity): BackdropProps {
  return {
    color: "red",
    node: undefined,
    strength: "subtle",
    direction: "down",
    art: null,
    opacity: 0.7,
    activity,
    pointer: { now: () => null },
  };
}

/** Let the dynamic import and the mount settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

afterEach(() => {
  Object.assign(told, { mounts: 0, writes: 0, editing: [], disposed: 0 });
});

describe("the Arena's head", () => {
  it("mounts its scene once, whatever the owner types: 30 keystrokes and an edit are told to it, never a remount", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let writes = 0;
    act(() => {
      root.render(<ArenaBackdrop {...props({ ...QUIET_ACTIVITY, editing: false, writes })} />);
    });
    await settle();
    expect(told.mounts).toBe(1);
    const frame = host.firstElementChild;

    for (let key = 0; key < 30; key++) {
      writes += 1;
      act(() => {
        root.render(<ArenaBackdrop {...props({ ...QUIET_ACTIVITY, editing: true, writes })} />);
      });
    }
    writes += 1;
    act(() => {
      root.render(<ArenaBackdrop {...props({ ...QUIET_ACTIVITY, editing: false, writes })} />);
    });
    await settle();

    expect(told.mounts).toBe(1);
    expect(told.disposed).toBe(0);
    expect(host.firstElementChild).toBe(frame);
    expect(told.writes).toBe(31);
    expect(told.editing).toEqual([false, true, false]);

    act(() => {
      root.unmount();
    });
    expect(told.disposed).toBe(1);
  });
});
