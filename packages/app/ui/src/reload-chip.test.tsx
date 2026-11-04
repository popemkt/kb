/**
 * The reload chip (`reload-chip.tsx`): what it says in each state, and a
 * "Reload now" that leaves the caret where it is, so the reload carries it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { useUiStore } from "@/stores/ui.store";
import { ReloadChip } from "./reload-chip";

describe("the reload chip", () => {
  let dom: InstalledDom;
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    dom = installDomGlobals();
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.append(container as never);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    useUiStore.getState().setReload("none");
    dom.restore();
  });

  const show = (state: "none" | "waiting" | "reloading" | "stuck") =>
    act(() => {
      useUiStore.getState().setReload(state);
      root.render(<ReloadChip />);
    });

  it("says where the reload stands, and offers it now unless it is under way", () => {
    show("none");
    expect(container.textContent).toBe("");
    show("waiting");
    expect(container.textContent).toBe("kb was updated · reloads when you pauseReload now");
    show("stuck");
    expect(container.textContent).toBe("kb was updatedReload now");
    show("reloading");
    expect(container.querySelector("button")).toBeNull();
  });

  it("takes no focus when pressed, so the caret stays in its row to be carried", () => {
    show("waiting");
    const press = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    container.querySelector("button")?.dispatchEvent(press as unknown as Event);
    expect(press.defaultPrevented).toBe(true);
  });
});
