import { describe, expect, it } from "vitest";
import { QUIET_ACTIVITY } from "@kb/ui-sdk";
import { tellOwner, type Hears, type Told } from "./owner";

function hearing(): { hears: Hears; heard: string[] } {
  const heard: string[] = [];
  return {
    heard,
    hears: {
      write: () => void heard.push("write"),
      navigate: () => void heard.push("navigate"),
      setEditing: (editing) => void heard.push(`editing ${editing}`),
    },
  };
}

const at = (activity: Partial<Told["activity"]>, nodeId = "n.a"): Told => ({
  activity: { ...QUIET_ACTIVITY, ...activity },
  nodeId,
});

describe("tellOwner", () => {
  it("tells a write once per moved count, a page change as a navigation, and editing as a state", () => {
    const { hears, heard } = hearing();
    let seen = at({});
    seen = tellOwner(hears, seen, at({ writes: 3, editing: true }));
    seen = tellOwner(hears, seen, at({ writes: 3, editing: true }));
    tellOwner(hears, seen, at({ writes: 3 }, "n.b"));
    expect(heard).toEqual(["write", "editing true", "editing true", "navigate", "editing false"]);
  });
});
